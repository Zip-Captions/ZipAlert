interface Env {
  ZIPALERT_API_KEY?: string;
  ZIPALERT_HMAC_SECRET?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_SERVICE_ACCOUNT_KEY?: string; // JSON PEM Service Account
}

// Convert Base64 string to ArrayBuffer for Web Crypto PKCS8 private key parsing
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binaryString = atob(b64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper to base64url encode buffers/strings
function base64urlEncode(source: ArrayBuffer | string): string {
  let binary = "";
  if (typeof source === "string") {
    binary = btoa(unescape(encodeURIComponent(source)));
  } else {
    const bytes = new Uint8Array(source);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    binary = btoa(binary);
  }
  return binary.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Sign a Google OAuth2 JWT locally on the Edge using Web Crypto APIs
async function generateGoogleAccessToken(
  clientEmail: string,
  privateKeyPEM: string
): Promise<string> {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemBody = privateKeyPEM
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s+/g, "");

  const binaryDer = base64ToArrayBuffer(pemBody);

  // Import PKCS8 private key for RSASSA-PKCS1-v1_5
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = { alg: "RS256", typ: "JWT" };
  const jwtPayload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(jwtHeader));
  const encodedPayload = base64urlEncode(JSON.stringify(jwtPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(signingInput)
  );

  const encodedSignature = base64urlEncode(signatureBuffer);
  const signedJWT = `${signingInput}.${encodedSignature}`;

  // Exchange JWT for Google Access Token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJWT}`,
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Google token exchange failed: ${errorText}`);
  }

  const tokenData: any = await tokenResponse.json();
  return tokenData.access_token;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Extract critical authorization headers
  const apiKeyHeader = request.headers.get("X-API-Key");
  const signatureHeader = request.headers.get("X-Signature-SHA256");

  const expectedApiKey = env.ZIPALERT_API_KEY || "DEV_API_KEY_9982";
  const expectedHmacSecret = env.ZIPALERT_HMAC_SECRET || "DEV_HMAC_SECRET_5541";

  // 1. API Key Validation
  if (!apiKeyHeader || apiKeyHeader !== expectedApiKey) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Unauthorized: Invalid or missing X-API-Key.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Clone request body to buffer raw text for HMAC checking
  const rawBody = await request.clone().text();

  // 2. Cryptographic SHA-256 HMAC Signature Verification
  if (!signatureHeader) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Forbidden: Missing X-Signature-SHA256 verification header.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const secretKeyData = encoder.encode(expectedHmacSecret);
  
  // Import HMAC CryptoKey
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKeyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureData = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(rawBody)
  );

  const computedHex = Array.from(new Uint8Array(signatureData))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHex !== signatureHeader.toLowerCase()) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Forbidden: Cryptographic signature mismatch. Payload tampered.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse Body payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: "Bad Request: Invalid JSON body." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const schoolId = payload.schoolId || "highland_prep_102";
  let isFireTrip = false;
  let triggerSource = "Hardware Ingestion Gateway";
  let triggerDetails = "Emergency loop activated.";

  // 3. Dry-Contact Ingestion Logic (e.g. {"contact_closed": true})
  if (payload.contact_closed === true) {
    isFireTrip = true;
    triggerSource = "Physical Dry-Contact IoT Relay";
    triggerDetails = `Contact closed trip detected at GPIO Port ${payload.gpio_port || "1"}.`;
  }

  // 4. Honeywell CLSS / Enterprise API Compatibility Ingestion
  const honeywellSourceHeader = request.headers.get("X-Honeywell-Source");
  const eventType = payload.eventType || "";
  const eventClass = payload.eventClass || "";
  const description = payload.description || payload.details?.description || "";

  const hasHoneywellSignature = 
    honeywellSourceHeader === "CLSS" || 
    eventType.includes("Fire Loop Event") ||
    description.includes("Fire Loop Event") ||
    eventClass.toLowerCase() === "fire";

  if (hasHoneywellSignature) {
    isFireTrip = true;
    triggerSource = "Honeywell CLSS Enterprise Integration";
    triggerDetails = `Commercial Fire Loop Event triggered at Panel ${payload.panelId || "0"}. Details: ${description || "General fire loop event detected."}`;
  }

  // Non-fire event filter
  if (!isFireTrip) {
    return new Response(
      JSON.stringify({
        success: true,
        message: "Payload validated successfully. No fire panel action required (contact remains open / normal).",
        details: payload,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 5. Cloud Firestore REST API Edge Update
  const projectId = env.FIREBASE_PROJECT_ID;
  const serviceAccountJsonStr = env.FIREBASE_SERVICE_ACCOUNT_KEY;

  const currentTimestamp = new Date().toISOString();

  // If environment variables are missing (local simulation / fallback testing)
  if (!projectId || !serviceAccountJsonStr) {
    console.warn("[Cloudflare Workers Edge] Missing Firestore configs. Running local dry-run simulation mode.");
    return new Response(
      JSON.stringify({
        success: true,
        simulated: true,
        message: "SIMULATED TRIGGER SUCCESSFUL: Physical Fire Panel loop tripped. Evacuate immediately.",
        schoolId,
        source: triggerSource,
        details: triggerDetails,
        timestamp: currentTimestamp
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJsonStr);
    
    // Generate secure Google OAuth2 Access Token
    const accessToken = await generateGoogleAccessToken(
      serviceAccount.client_email,
      serviceAccount.private_key
    );

    // Call Cloud Firestore REST API PATCH document endpoint
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/schools/${schoolId}/crisis/alert_active?updateMask.fieldPaths=status&updateMask.fieldPaths=message&updateMask.fieldPaths=triggeredBy&updateMask.fieldPaths=timestamp`;

    const patchPayload = {
      fields: {
        status: { stringValue: "FIRE_ALARM" },
        message: { stringValue: `CRITICAL: ${triggerDetails} Evacuate immediately.` },
        triggeredBy: { stringValue: triggerSource },
        timestamp: { stringValue: currentTimestamp },
      },
    };

    const firestoreResponse = await fetch(firestoreUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(patchPayload),
    });

    if (!firestoreResponse.ok) {
      const errorText = await firestoreResponse.text();
      throw new Error(`Firestore REST PATCH failed: ${errorText}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "SUCCESS: Live fire panel trigger updated Firestore.",
        schoolId,
        source: triggerSource,
        timestamp: currentTimestamp,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[Cloudflare Edge Worker] Hardware trigger failure:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: `Serverless Hardware Trigger Ingestion Failure: ${error.message}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
