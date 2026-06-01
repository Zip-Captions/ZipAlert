import React, { useState, useEffect, useRef } from "react";
import { 
  ShieldAlert, 
  Flame, 
  CheckCircle, 
  Activity, 
  Smartphone, 
  Users, 
  Clock, 
  VolumeX,
  Compass,
  Cpu,
  Tv,
  Settings,
  UserPlus,
  Key,
  UserCheck,
  XCircle,
  Layers,
  Award,
  Globe,
  Database,
  Wifi,
  Moon
} from "lucide-react";
import { auth, db, googleProvider, isFirebaseConfigured } from "./firebase";
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from "firebase/auth";
import { 
  doc, 
  onSnapshot, 
  updateDoc, 
  getDoc, 
  setDoc,
  deleteDoc,
  collection, 
  query, 
  where, 
  getDocs,
  limit
} from "firebase/firestore";

// Relational Multi-Tenant Configurations
const INITIAL_SCHOOL_ID = "highland_prep_102";

interface District {
  id: string;
  name: string;
  state: string;
  createdAt: string;
  schoolsCount: number;
}

interface License {
  id: string;
  districtId: string;
  status: "ACTIVE" | "EXPIRED" | "SUSPENDED";
  planType: "FREE" | "PREMIUM_ENTERPRISE";
  maxSchools: number;
  maxDevicesPerSchool: number;
  createdAt: string;
  expiresAt: string;
}

interface SchoolDetails {
  id: string;
  districtId: string;
  licenseId: string;
  name: string;
  createdAt: string;
  admins: string[];
  settings: {
    timezone: string;
    silentHoursStart: string;
    silentHoursEnd: string;
    allowStudentSelfEnrollment: boolean;
  };
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
  enrolledAt: string;
  expiresAt: string; // Graduation date TTL
}

interface Invitation {
  code: string;
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
}

interface Device {
  id: string;
  memberId: string;
  deviceName: string;
  deviceType: "WATCHOS" | "WEAROS" | "MOBILE_PWA" | "DISPLAY_NODE";
  registeredAt: string;
  batteryLevel: number;
}

interface AlertState {
  status: "NORMAL" | "FIRE_ALARM" | "LOCKDOWN" | "SOFT_LOCKDOWN";
  message: string;
  triggeredBy: string;
  timestamp: string;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [activeRole, setActiveRole] = useState<"SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT">(() => {
    const saved = localStorage.getItem("zip_alert_role");
    return (saved as any) || "STUDENT";
  });
  
  // Tab controller for Admin view: "CRISIS", "ROSTER", "SCHOOL_SETTINGS", "DEVICES"
  const [adminTab, setAdminTab] = useState<"CRISIS" | "ROSTER" | "SCHOOL_SETTINGS" | "DEVICES">("CRISIS");
  
  // Tab controller for Super Admin view: "DISTRICTS", "LICENSES", "GLOBAL_METRICS"
  const [superAdminTab, setSuperAdminTab] = useState<"DISTRICTS" | "LICENSES" | "GLOBAL_METRICS">("DISTRICTS");

  // Live collections state
  const [districts, setDistricts] = useState<District[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  // Multi-tenant School details
  const [school, setSchool] = useState<SchoolDetails>({
    id: INITIAL_SCHOOL_ID,
    districtId: "springfield_unified_902",
    licenseId: "LIC-HL102", // Cap: 4 devices
    name: "Highland Prep Academy",
    createdAt: "2024-06-01T08:00:00Z",
    admins: [],
    settings: {
      timezone: "America/New_York",
      silentHoursStart: "18:00",
      silentHoursEnd: "07:00",
      allowStudentSelfEnrollment: true
    }
  });

  // Enrollment forms
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [enrollmentName, setEnrollmentName] = useState("");
  const [isEnrolled, setIsEnrolled] = useState<boolean>(() => {
    const saved = localStorage.getItem("zip_alert_enrolled");
    return saved === "true";
  }); 
  const [enrollmentError, setEnrollmentError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Custom alert inputs
  const [customAlertMessage, setCustomAlertMessage] = useState("");
  const [customAlertLevel, setCustomAlertLevel] = useState<"LOCKDOWN" | "FIRE_ALARM" | "SOFT_LOCKDOWN">("LOCKDOWN");
  const [customAlertTarget, setCustomAlertTarget] = useState<"ALL_DEVICES" | "STAFF_ONLY">("ALL_DEVICES");



  // System alert state (0.5 KiB flat micro-payload architecture)
  const [currentAlert, setCurrentAlert] = useState<AlertState>({
    status: "NORMAL",
    message: "System fully operational. All security nodes active.",
    triggeredBy: "System Core",
    timestamp: new Date().toISOString()
  });

  // Billing Safeguards & Connection States
  const [connectionState, setConnectionState] = useState<"CONNECTED" | "SLEEPING" | "SUSPENDED">("CONNECTED");
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const IDLE_LIMIT = 4 * 60 * 60 * 1000; // 4 Hours standard timeout

  // Super Admin form states
  const [newDistrictName, setNewDistrictName] = useState("");
  const [newDistrictState, setNewDistrictState] = useState("");
  const [newLicenseDistrict, setNewLicenseDistrict] = useState("springfield_unified_902");
  const [newLicensePlan, setNewLicensePlan] = useState<"FREE" | "PREMIUM_ENTERPRISE">("PREMIUM_ENTERPRISE");
  const [newLicenseSchools, setNewLicenseSchools] = useState(10);
  const [newLicenseDevices, setNewLicenseDevices] = useState(100);
  const [newLicenseExpires, setNewLicenseExpires] = useState("2028-06-30");

  // Local state for hold triggers
  const [lockdownProgress, setLockdownProgress] = useState(0);
  const [fireProgress, setFireProgress] = useState(0);
  const lockdownIntervalRef = useRef<number | null>(null);
  const fireIntervalRef = useRef<number | null>(null);

  // Invite creation states
  const [newInviteRole, setNewInviteRole] = useState<"TEACHER" | "STUDENT">("STUDENT");
  const [newInviteUses, setNewInviteUses] = useState(10);

  // Screen Wake Lock API refs
  const wakeLockRef = useRef<any>(null);
  const [wakeLockStatus, setWakeLockStatus] = useState<string>("RELEASED");
  const hapticIntervalRef = useRef<number | null>(null);

  // Checks if the active school license is valid/active
  const getActiveLicense = (): License | undefined => {
    return licenses.find(lic => lic.id === school.licenseId);
  };

  const isLicenseViolated = (): boolean => {
    const lic = getActiveLicense();
    return !lic || lic.status !== "ACTIVE";
  };

  // --- STRICTLY LIVE: Google Sign-In Action ---
  const handleGoogleSignInAction = async () => {
    if (!isFirebaseConfigured || !auth) return;
    setEnrollmentError("");
    try {
      await signInWithPopup(auth, googleProvider);
      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
    } catch (error: any) {
      console.error("[PWA Auth] Google Auth Error:", error);
      setEnrollmentError(`Google Sign-In failed: ${error.message}`);
    }
  };

  // --- PROD FIRESTORE: snapshot connection manager ---
  const establishSnapshotListener = () => {
    if (!isFirebaseConfigured || !db) return;
    if (unsubscribeRef.current) unsubscribeRef.current();

    setConnectionState("CONNECTED");
    
    // Bind directly to live Firestore document `/schools/{schoolId}/system_status/current_alert`
    const alertDocRef = doc(db, "schools", school.id, "system_status", "current_alert");
    console.log(`[PWA Client] Connecting live snapshot listener to Firestore path: ${alertDocRef.path}`);

    const unsubscribe = onSnapshot(alertDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log("[PWA Client] Live Firestore alert updated:", data);
        setCurrentAlert({
          status: data.status || "NORMAL",
          message: data.message || "System fully operational.",
          triggeredBy: data.triggeredBy || "System Core",
          timestamp: data.timestamp || new Date().toISOString()
        });
      } else {
        setCurrentAlert({
          status: "NORMAL",
          message: "System fully operational. All security nodes active.",
          triggeredBy: "System Core",
          timestamp: new Date().toISOString()
        });
      }
    }, (error) => {
      console.error("[PWA Client] Live snapshot listener error:", error);
      if (error.code === "permission-denied") {
        setConnectionState("SUSPENDED");
      }
    });

    unsubscribeRef.current = unsubscribe;
  };

  const disconnectSnapshotListener = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setConnectionState("SLEEPING");
    releaseWakeLock();
    stopHaptics();
  };

  const handleCustomBroadcastSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customAlertMessage.trim()) {
      alert("Please enter a custom alert message.");
      return;
    }
    
    triggerAlert(
      customAlertLevel, 
      customAlertMessage.trim()
    );
    
    setSuccessMessage(`Custom broadcast dispatched: ${customAlertLevel} sent to ${customAlertTarget === "ALL_DEVICES" ? "All Devices" : "Staff Only"}.`);
    setCustomAlertMessage("");
    setTimeout(() => setSuccessMessage(""), 5000);
  };

  // User input tracking to reset the 4-hour idle timer
  const resetIdleTimer = () => {
    if (idleTimeoutRef.current) window.clearTimeout(idleTimeoutRef.current);
    
    // Only idle teardown if the status is NORMAL (never sleep during active emergencies)
    if (currentAlert.status !== "NORMAL") {
      if (connectionState === "SLEEPING") wakeSystem();
      return;
    }

    // Restrict system waking: do NOT wake on mousemove or keypress activity events if sleeping.
    // Waking up is exclusively triggered by clicking the "Wake and Reconnect Socket" button.
    if (connectionState === "SLEEPING") {
      return;
    }

    idleTimeoutRef.current = window.setTimeout(() => {
      console.warn("[PWA Client] Device stationary/backgrounded for 4 hours without active alert. Entering sleep.");
      disconnectSnapshotListener();
    }, IDLE_LIMIT);
  };

  const wakeSystem = () => {
    console.log("[PWA Client] Activity detected. Re-subscribing to Firestore snap socket.");
    establishSnapshotListener();
    resetIdleTimer();
  };


  // --- STRICTLY LIVE: Firebase Auth Observer & Session Hydration ---
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      console.warn("[PWA Client] Firebase Auth not configured. Skipping Auth observer.");
      return () => {};
    }
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setCurrentUser(firebaseUser);
      if (firebaseUser) {
        console.log("[PWA Auth] Google User authenticated:", firebaseUser.email);
        
        // 1. Check if Super Admin in global /users/{uid}
        try {
          const superAdminDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (superAdminDoc.exists() && superAdminDoc.data().role === "SUPER_ADMIN") {
            setActiveRole("SUPER_ADMIN");
            setIsEnrolled(true);
            localStorage.setItem("zip_alert_enrolled", "true");
            localStorage.setItem("zip_alert_role", "SUPER_ADMIN");
            localStorage.setItem("zip_alert_member_id", firebaseUser.uid);
            localStorage.setItem("zip_alert_member_name", firebaseUser.displayName || "SaaS Director");
            establishSnapshotListener();
            return;
          }
        } catch (err) {
          console.warn("[PWA Auth] Error verifying Super Admin status:", err);
        }

        // 2. Check roster under /schools/{schoolId}/members/{uid}
        try {
          const rosterDoc = await getDoc(doc(db, "schools", school.id, "members", firebaseUser.uid));
          if (rosterDoc.exists()) {
            const data = rosterDoc.data() as Member;
            setActiveRole(data.role);
            setIsEnrolled(true);
            localStorage.setItem("zip_alert_enrolled", "true");
            localStorage.setItem("zip_alert_role", data.role);
            localStorage.setItem("zip_alert_member_id", firebaseUser.uid);
            localStorage.setItem("zip_alert_member_name", data.name);
            establishSnapshotListener();
            return;
          }
        } catch (err) {
          console.warn("[PWA Auth] Error checking roster document:", err);
        }

        // 3. Fallback: Search roster for a pre-populated email match
        try {
          const membersRef = collection(db, "schools", school.id, "members");
          const q = query(membersRef, where("email", "==", firebaseUser.email), limit(1));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const matchedDoc = querySnapshot.docs[0];
            const data = matchedDoc.data() as Member;
            
            // Re-write roster record under their authenticated Google UID
            await setDoc(doc(db, "schools", school.id, "members", firebaseUser.uid), {
              ...data,
              id: firebaseUser.uid
            });
            
            setActiveRole(data.role);
            setIsEnrolled(true);
            localStorage.setItem("zip_alert_enrolled", "true");
            localStorage.setItem("zip_alert_role", data.role);
            localStorage.setItem("zip_alert_member_id", firebaseUser.uid);
            localStorage.setItem("zip_alert_member_name", data.name);
            establishSnapshotListener();
            return;
          }
        } catch (err) {
          console.error("[PWA Auth] Email fallback check failed:", err);
        }

        // 4. Authenticated but not enrolled yet
        setIsEnrolled(false);
      } else {
        // Sign out cleared
        setIsEnrolled(false);
        setActiveRole("STUDENT");
      }
    });

    return () => unsubscribeAuth();
  }, [school.id]);

  // --- PROD DATA SYNC: Hydrate dynamic lists from live Firestore ---
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;
    if (isEnrolled && (activeRole === "ADMIN" || activeRole === "SUPER_ADMIN")) {
      // 1. Load active roster
      const rosterQuery = collection(db, "schools", school.id, "members");
      getDocs(rosterQuery).then(snapshot => {
        const loadedMembers: Member[] = [];
        snapshot.forEach(doc => loadedMembers.push(doc.data() as Member));
        if (loadedMembers.length > 0) setMembers(loadedMembers);
      }).catch(err => console.error("Roster fetch error:", err));

      // 2. Load active devices
      const devicesQuery = collection(db, "schools", school.id, "devices");
      getDocs(devicesQuery).then(snapshot => {
        const loadedDevices: Device[] = [];
        snapshot.forEach(doc => loadedDevices.push(doc.data() as Device));
        if (loadedDevices.length > 0) setDevices(loadedDevices);
      }).catch(err => console.error("Devices fetch error:", err));

      // 3. Load invitations
      const invitesQuery = collection(db, "schools", school.id, "invitations");
      getDocs(invitesQuery).then(snapshot => {
        const loadedInvites: Invitation[] = [];
        snapshot.forEach(doc => loadedInvites.push(doc.data() as Invitation));
        if (loadedInvites.length > 0) setInvitations(loadedInvites);
      }).catch(err => console.error("Invitations fetch error:", err));
    }

    if (isEnrolled && activeRole === "SUPER_ADMIN") {
      // 4. Load districts (SaaS Admin)
      getDocs(collection(db, "districts")).then(snapshot => {
        const loadedDistricts: District[] = [];
        snapshot.forEach(doc => loadedDistricts.push(doc.data() as District));
        if (loadedDistricts.length > 0) setDistricts(loadedDistricts);
      }).catch(err => console.error("Districts fetch error:", err));

      // 5. Load licenses (SaaS Admin)
      getDocs(collection(db, "licenses")).then(snapshot => {
        const loadedLicenses: License[] = [];
        snapshot.forEach(doc => loadedLicenses.push(doc.data() as License));
        if (loadedLicenses.length > 0) setLicenses(loadedLicenses);
      }).catch(err => console.error("Licenses fetch error:", err));
    }
  }, [isEnrolled, activeRole, adminTab, school.id]);

  // --- URL INVITE LINKER: Bind pending links ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const enrollCode = params.get("enroll") || params.get("token") || params.get("invite");
    const nameParam = params.get("name") || params.get("username") || "";

    if (enrollCode) {
      console.log("[PWA Linker] URL-based invite token intercepted:", enrollCode);
      localStorage.setItem("zip_alert_pending_invite", enrollCode.trim().toUpperCase());
      if (nameParam) {
        localStorage.setItem("zip_alert_pending_name", nameParam);
      }
      
      // Silently clean address bar
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: cleanUrl }, "", cleanUrl);
    }
  }, []);

  useEffect(() => {
    if (currentUser && !isEnrolled) {
      const pendingInvite = localStorage.getItem("zip_alert_pending_invite");
      const pendingName = localStorage.getItem("zip_alert_pending_name") || currentUser.displayName || "";
      if (pendingInvite) {
        console.log("[PWA Linker] Pre-filling pending invite:", pendingInvite);
        setEnrollmentCode(pendingInvite);
        setEnrollmentName(pendingName);
        localStorage.removeItem("zip_alert_pending_invite");
        localStorage.removeItem("zip_alert_pending_name");
      }
    }
  }, [currentUser, isEnrolled]);

  // Listen to mouse, key, and touch events to maintain connection
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    establishSnapshotListener();
    resetIdleTimer();

    const activityEvents = ["mousemove", "keydown", "touchstart", "click", "visibilitychange"];
    activityEvents.forEach(event => {
      window.addEventListener(event, resetIdleTimer);
    });

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
      if (idleTimeoutRef.current) window.clearTimeout(idleTimeoutRef.current);
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetIdleTimer);
      });
    };
  }, [currentAlert.status]);

  // Request HTML5 Screen Wake Lock
  const requestWakeLock = async () => {
    if ("wakeLock" in navigator && connectionState === "CONNECTED") {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        setWakeLockStatus("ACTIVE");
      } catch (err) {
        console.error("Wake Lock rejected:", err);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setWakeLockStatus("RELEASED");
    }
  };

  const startContinuousHaptics = (intensity: "emergency" | "discrete") => {
    if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
    if ("vibrate" in navigator && connectionState === "CONNECTED") {
      if (intensity === "emergency") {
        navigator.vibrate([500, 100, 500]);
        hapticIntervalRef.current = window.setInterval(() => {
          navigator.vibrate([500, 100, 500]);
        }, 1200);
      } else {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
    }
  };

  const stopHaptics = () => {
    if (hapticIntervalRef.current) {
      clearInterval(hapticIntervalRef.current);
      hapticIntervalRef.current = null;
      if ("vibrate" in navigator) {
        try {
          navigator.vibrate(0);
        } catch (e) {
          // Suppress browser gesture interventions
        }
      }
    }
  };

  // Status-driven Wake Lock & Haptic management
  useEffect(() => {
    const hasEmergency = currentAlert.status === "LOCKDOWN" || currentAlert.status === "FIRE_ALARM";
    const isEnrolledActive = getActiveMember()?.status === "ACTIVE";

    // Stop all overlays, haptics if license suspended, user suspended, or device is sleeping
    if (isLicenseViolated() || !isEnrolled || !isEnrolledActive || connectionState === "SLEEPING") {
      stopHaptics();
      releaseWakeLock();
      return;
    }

    if (hasEmergency || currentAlert.status === "SOFT_LOCKDOWN") {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    if (activeRole === "STUDENT" && hasEmergency) {
      startContinuousHaptics("emergency");
    } else if (activeRole === "TEACHER" && currentAlert.status === "SOFT_LOCKDOWN") {
      startContinuousHaptics("discrete");
    } else {
      stopHaptics();
    }

    return () => {
      stopHaptics();
      releaseWakeLock();
    };
  }, [currentAlert.status, activeRole, isEnrolled, licenses, connectionState]);

  // Live profile helper to resolve active user profile
  const getActiveMember = (): Member | undefined => {
    if (activeRole === "SUPER_ADMIN") {
      return { id: currentUser?.uid || "USR-0001", name: currentUser?.displayName || "SaaS Platform Director", email: currentUser?.email || "director@zipalert.co", role: "ADMIN", status: "ACTIVE", enrolledAt: "2023-01-01", expiresAt: "NEVER" };
    }
    return members.find(m => m.id === currentUser?.uid) || {
      id: currentUser?.uid || "USR-MOCK",
      name: currentUser?.displayName || localStorage.getItem("zip_alert_member_name") || "Verified Node",
      email: currentUser?.email || localStorage.getItem("zip_alert_member_email") || "",
      role: activeRole,
      status: "ACTIVE",
      enrolledAt: new Date().toISOString().split("T")[0],
      expiresAt: "NEVER"
    };
  };

  // Live Enrollment validation code
  const handleSelfEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollmentError("");

    if (!isFirebaseConfigured || !db) {
      setEnrollmentError("Firebase is not configured.");
      return;
    }

    if (!currentUser) {
      setEnrollmentError("Please sign in with Google first.");
      return;
    }

    if (!enrollmentCode || !enrollmentName) {
      setEnrollmentError("Please fill out all fields.");
      return;
    }

    try {
      const activeLic = getActiveLicense();
      
      // 1. Validate Licensing
      if (isLicenseViolated()) {
        setEnrollmentError("This school's license has expired or is suspended. Access locked.");
        return;
      }

      // 2. Validate Quota constraints (Hard licensing cap check)
      if (activeLic && devices.length >= activeLic.maxDevicesPerSchool) {
        setEnrollmentError(`District licensing quota reached. (Max ${activeLic.maxDevicesPerSchool} devices allowed per school).`);
        return;
      }

      // 3. Match invite token from Firestore
      const inviteDocRef = doc(db, "schools", school.id, "invitations", enrollmentCode.trim().toUpperCase());
      const inviteDoc = await getDoc(inviteDocRef);
      if (!inviteDoc.exists()) {
        setEnrollmentError("Invalid or expired invitation token.");
        return;
      }

      const invite = inviteDoc.data() as Invitation;
      if (invite.usedCount >= invite.maxUses) {
        setEnrollmentError("This invitation code has reached its maximum use limit.");
        return;
      }

      // 4. Create member record in Firestore
      const newMember: Member = {
        id: currentUser.uid,
        name: enrollmentName,
        email: currentUser.email!,
        role: invite.role,
        status: "ACTIVE",
        enrolledAt: new Date().toISOString().split("T")[0],
        expiresAt: invite.role === "STUDENT" ? `${new Date().getFullYear() + 3}-06-15 (Graduation)` : "NEVER"
      };

      await setDoc(doc(db, "schools", school.id, "members", currentUser.uid), newMember);

      // 5. Register device in Firestore
      const newDeviceId = `DEV-${Math.floor(1000 + Math.random() * 9000)}`;
      const newDevice: Device = {
        id: newDeviceId,
        memberId: currentUser.uid,
        deviceName: `${enrollmentName}'s Companion Phone`,
        deviceType: "MOBILE_PWA",
        registeredAt: new Date().toISOString().split("T")[0],
        batteryLevel: 95
      };

      await setDoc(doc(db, "schools", school.id, "devices", newDeviceId), newDevice);

      // 6. Update invite usage count in Firestore
      await updateDoc(inviteDocRef, {
        usedCount: invite.usedCount + 1
      });

      // 7. Update state and local storage details
      setActiveRole(invite.role);
      setIsEnrolled(true);
      
      localStorage.setItem("zip_alert_enrolled", "true");
      localStorage.setItem("zip_alert_role", invite.role);
      localStorage.setItem("zip_alert_member_id", currentUser.uid);
      localStorage.setItem("zip_alert_member_name", enrollmentName);
      localStorage.setItem("zip_alert_member_email", currentUser.email!);
      setSuccessMessage(`Welcome, ${enrollmentName}! Account successfully linked.`);

      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
    } catch (err: any) {
      console.error("[PWA Enrollment] Enrollment error:", err);
      setEnrollmentError(`Enrollment failed: ${err.message}`);
    }
  };

  // Live Admin trigger handlers
  const triggerAlert = async (status: AlertState["status"], message: string) => {
    if (!isFirebaseConfigured || !db) return;
    const alertDocRef = doc(db, "schools", school.id, "system_status", "current_alert");
    try {
      await setDoc(alertDocRef, {
        status,
        message,
        triggeredBy: getActiveMember()?.name || "Verified Administrator",
        timestamp: new Date().toISOString()
      }, { merge: true });
      
      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
    } catch (error: any) {
      console.error("[PWA Client] Failed to trigger live lockdown alert:", error);
      alert("Crisis Broadcast failed: insufficient Firestore credentials.");
    }
  };

  const resetAlert = async () => {
    if (!isFirebaseConfigured || !db) return;
    const alertDocRef = doc(db, "schools", school.id, "system_status", "current_alert");
    try {
      await setDoc(alertDocRef, {
        status: "NORMAL",
        message: "System fully operational. All security nodes active.",
        triggeredBy: getActiveMember()?.name || "Verified Administrator",
        timestamp: new Date().toISOString()
      }, { merge: true });
      
      stopHaptics();
    } catch (error: any) {
      console.error("[PWA Client] Failed to reset live alert:", error);
    }
  };

  // Hold triggers
  const startTriggerHold = (type: "LOCKDOWN" | "FIRE_ALARM") => {
    if (type === "LOCKDOWN") {
      lockdownIntervalRef.current = window.setInterval(() => {
        setLockdownProgress((prev) => {
          if (prev >= 100) {
            clearInterval(lockdownIntervalRef.current!);
            triggerAlert("LOCKDOWN", "CRITICAL THREAT: HARD LOCKDOWN INITIATED. SECURE ALL ROOMS IMMEDIATELY.");
            return 100;
          }
          return prev + 5;
        });
      }, 100);
    } else {
      fireIntervalRef.current = window.setInterval(() => {
        setFireProgress((prev) => {
          if (prev >= 100) {
            clearInterval(fireIntervalRef.current!);
            triggerAlert("FIRE_ALARM", "CRITICAL EVACUATION: FIRE ALARM TRIPPED. EVACUATE BUILDING IMMEDIATELY.");
            return 100;
          }
          return prev + 5;
        });
      }, 100);
    }
  };

  const cancelTriggerHold = (type: "LOCKDOWN" | "FIRE_ALARM") => {
    if (type === "LOCKDOWN") {
      if (lockdownIntervalRef.current) clearInterval(lockdownIntervalRef.current);
      setLockdownProgress(0);
    } else {
      if (fireIntervalRef.current) clearInterval(fireIntervalRef.current);
      setFireProgress(0);
    }
  };

  // Live Roster Management
  const toggleMemberStatus = async (id: string) => {
    try {
      const m = members.find(x => x.id === id);
      if (m) {
        const nextStatus = m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
        await updateDoc(doc(db, "schools", school.id, "members", id), { status: nextStatus });
        setMembers(members.map(x => x.id === id ? { ...x, status: nextStatus } : x));
        if ("vibrate" in navigator) navigator.vibrate(50);
      }
    } catch (err) {
      console.error("Failed to toggle status:", err);
    }
  };

  const removeMember = async (id: string) => {
    if (!isFirebaseConfigured || !db) return;
    try {
      await deleteDoc(doc(db, "schools", school.id, "members", id));
      setMembers(members.filter(m => m.id !== id));
      if ("vibrate" in navigator) navigator.vibrate(80);
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  // Live Invitation creation
  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFirebaseConfigured || !db) return;
    const chars = "ABCDEFGHJKLMNOPQRSTUVWXYZ0123456789";
    let token = "";
    for (let i = 0; i < 6; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const newInvite: Invitation = {
      code: token,
      role: newInviteRole,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 2).toISOString(),
      maxUses: newInviteUses,
      usedCount: 0
    };

    try {
      await setDoc(doc(db, "schools", school.id, "invitations", token), newInvite);
      setInvitations([newInvite, ...invitations]);
      if ("vibrate" in navigator) navigator.vibrate(60);
    } catch (err) {
      console.error("Failed to create invite:", err);
    }
  };

  // Super Admin - Create District
  const handleCreateDistrict = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFirebaseConfigured || !db) return;
    if (!newDistrictName || !newDistrictState) return;

    const newId = newDistrictName.toLowerCase().replace(/ /g, "_") + "_" + Math.floor(100 + Math.random() * 900);
    const newDist: District = {
      id: newId,
      name: newDistrictName,
      state: newDistrictState.toUpperCase(),
      createdAt: new Date().toISOString().split("T")[0],
      schoolsCount: 0
    };

    try {
      await setDoc(doc(db, "districts", newId), newDist);
      setDistricts([...districts, newDist]);
      setNewDistrictName("");
      setNewDistrictState("");
      if ("vibrate" in navigator) navigator.vibrate(60);
    } catch (err) {
      console.error("Failed to create district:", err);
    }
  };

  // Super Admin - Allocate License
  const handleAllocateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFirebaseConfigured || !db) return;
    
    const newLicId = `LIC-${Math.floor(10000 + Math.random() * 90000)}`;
    const newLic: License = {
      id: newLicId,
      districtId: newLicenseDistrict,
      status: "ACTIVE",
      planType: newLicensePlan,
      maxSchools: newLicenseSchools,
      maxDevicesPerSchool: newLicenseDevices,
      createdAt: new Date().toISOString().split("T")[0],
      expiresAt: newLicenseExpires
    };

    try {
      await setDoc(doc(db, "licenses", newLicId), newLic);
      setLicenses([newLic, ...licenses]);
      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
    } catch (err) {
      console.error("Failed to allocate license:", err);
    }
  };

  // Toggles the status of a specific district license (to test lockouts)
  const toggleLicenseStatus = async (id: string) => {
    if (!isFirebaseConfigured || !db) return;
    const lic = licenses.find(x => x.id === id);
    if (!lic) return;
    const nextStatus = lic.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      await updateDoc(doc(db, "licenses", id), { status: nextStatus });
      setLicenses(licenses.map(l => l.id === id ? { ...l, status: nextStatus } : l));
      if ("vibrate" in navigator) navigator.vibrate(50);
    } catch (err) {
      console.error("Failed to toggle license:", err);
    }
  };

  // School settings updates
  const handleUpdateSchoolSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFirebaseConfigured || !db) return;
    try {
      await setDoc(doc(db, "schools", school.id), {
        settings: school.settings
      }, { merge: true });
      if ("vibrate" in navigator) navigator.vibrate([50, 50]);
      alert("School settings committed to Firestore.");
    } catch (err) {
      console.error("Failed to update school settings:", err);
    }
  };

  // Sign out / Disconnect device node cleanly
  const handleSignOut = async () => {
    try {
      if (isFirebaseConfigured && auth) {
        await signOut(auth);
      }
      localStorage.removeItem("zip_alert_enrolled");
      localStorage.removeItem("zip_alert_role");
      localStorage.removeItem("zip_alert_member_id");
      localStorage.removeItem("zip_alert_member_name");
      localStorage.removeItem("zip_alert_member_email");
      setIsEnrolled(false);
      setActiveRole("STUDENT");
      setSuccessMessage("");
      setEnrollmentError("");
      if ("vibrate" in navigator) navigator.vibrate([100, 50]);
    } catch (error) {
      console.error("[PWA Auth] Sign-out failed:", error);
    }
  };

  const activeMember = getActiveMember();
  const currentLicense = getActiveLicense();

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen bg-[#07080d] flex items-center justify-center p-6 font-sans select-none">
        <div className="max-w-xl w-full glass-panel p-8 rounded-3xl border-amber-500/40 text-center space-y-6 animate-fadeIn">
          <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-2xl mx-auto flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-amber-400 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-white uppercase tracking-wider">Firebase Configuration Required</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              ZipAlert is running a strictly live production design but could not detect your Firebase Web Client keys. All offline simulations are disabled.
            </p>
          </div>
          <div className="bg-black/30 border border-white/5 rounded-2xl p-5 text-left space-y-3 font-mono text-xs text-slate-300">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Required Environment Variables (.env / Cloudflare Settings):</p>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span>VITE_FIREBASE_API_KEY</span>
                <span className="text-red-400 font-bold">MISSING</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span>VITE_FIREBASE_PROJECT_ID</span>
                <span className="text-red-400 font-bold">MISSING</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span>VITE_FIREBASE_AUTH_DOMAIN</span>
                <span className="text-red-400 font-bold">MISSING</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span>VITE_FIREBASE_STORAGE_BUCKET</span>
                <span className="text-red-400 font-bold">MISSING</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1">
                <span>VITE_FIREBASE_MESSAGING_SENDER_ID</span>
                <span className="text-red-400 font-bold">MISSING</span>
              </div>
              <div className="flex justify-between">
                <span>VITE_FIREBASE_APP_ID</span>
                <span className="text-red-400 font-bold">MISSING</span>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-400 leading-normal text-left font-sans bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4.5 space-y-1.5">
            <strong className="text-amber-400 block font-bold">IT Admin Action Needed:</strong>
            <p>1. Local Development: Create a <code>.env</code> file in your local <code>web-pwa/</code> directory containing these keys.</p>
            <p>2. Live Production: Configure these 6 variables in your <strong>Cloudflare Pages Dashboard</strong> under project build settings, and trigger a fresh redeploy.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[#07080d] selection:bg-cyan-500 selection:text-black">
      
      {/* Floating Header */}
      <header className="z-50 border-b border-white/5 bg-[#0a0c16]/80 backdrop-blur-md sticky top-0 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/10">
            <ShieldAlert className="w-6 h-6 text-slate-100" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5 animate-fadeIn">
              ZipAlert <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">V3.5 SaaS</span>
            </h1>
            {isEnrolled ? (
              <p className="text-[11px] text-slate-400 font-mono">{school.name} ({school.id})</p>
            ) : (
              <p className="text-[11px] text-slate-400 font-mono">Secure Standby Gateway</p>
            )}
          </div>
        </div>

        {/* User Profile & Sign Out Controls */}
        {isEnrolled && (
          <div className="flex items-center gap-4 animate-fadeIn">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-bold text-white leading-none">
                {activeRole === "SUPER_ADMIN" ? "Platform Director" : activeMember?.name || "Verified Node"}
              </span>
              <span className="text-[10px] text-cyan-400 font-mono uppercase tracking-wider mt-0.5">
                {activeRole === "SUPER_ADMIN" ? "SaaS Super Admin" : activeRole}
              </span>
            </div>
            
            <button
              onClick={handleSignOut}
              className="px-3.5 py-2 bg-red-950/20 hover:bg-red-900/30 border border-red-500/25 text-red-400 hover:text-red-300 text-xs font-bold rounded-xl active:scale-[0.98] transition-all cursor-pointer flex items-center gap-1.5 uppercase tracking-wide"
            >
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Disconnect Node</span>
            </button>
          </div>
        )}
      </header>

      {/* Standby Telemetry Bar */}
      <div className="px-6 py-2 bg-white/[0.02] border-b border-white/5 flex items-center justify-between text-[11px] font-mono text-slate-500">
        <div className="flex items-center gap-2">
          <Wifi className={`w-3.5 h-3.5 ${connectionState === "CONNECTED" ? "text-emerald-400 animate-pulse" : "text-amber-500"}`} />
          <span>Active Edge Node: <strong className={connectionState === "CONNECTED" ? "text-emerald-400" : "text-amber-400"}>{connectionState}</strong></span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Activity className={`w-3 h-3 ${wakeLockStatus === "ACTIVE" ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
            <span>Standby Wake Lock:</span>
            <span className={wakeLockStatus === "ACTIVE" ? "text-emerald-400 font-bold" : "text-slate-400"}>
              {wakeLockStatus}
            </span>
          </div>
        </div>
      </div>

      {/* SLEEP CONNECTION BLOCKED OVERLAY */}
      {connectionState === "SLEEPING" && (
        <div className="fixed inset-0 bg-[#07080d]/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-fadeIn">
          <div className="max-w-md w-full glass-panel p-8 rounded-3xl text-center space-y-6 border-amber-500/40">
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-full mx-auto flex items-center justify-center">
              <Moon className="w-8 h-8 text-amber-400 animate-pulse" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-white uppercase tracking-wider">Device Node Sleeping</h3>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                ZipAlert disconnected the real-time Firestore database socket after **4 hours of absolute inactivity** to prevent billing read leaks.
              </p>
              <p className="text-[11px] text-amber-400 font-mono mt-3 uppercase tracking-wider">
                System remains alertable in background via high-priority FCM Push.
              </p>
            </div>
            <button
              onClick={wakeSystem}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-sm font-semibold hover:from-emerald-500 hover:to-emerald-400 transition-all text-white shadow-lg shadow-emerald-600/20"
            >
              Wake and Reconnect Socket
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 w-full max-w-7xl mx-auto p-6 md:p-8 flex flex-col">

        {/* ------------------ ENROLLMENT WIZARD ------------------ */}
        {!isEnrolled ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center py-6 lg:py-12 animate-fadeIn max-w-6xl mx-auto w-full">
            {/* LEFT COLUMN: BRAND MARKETING HERO */}
            <div className="lg:col-span-7 space-y-8 text-left">
              <div className="space-y-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                  Active Edge Defense
                </span>
                <h2 className="text-4xl lg:text-5xl font-black text-white leading-[1.1] tracking-tight uppercase">
                  Continuous <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">Standby Protection</span> For Modern Schools
                </h2>
                <p className="text-slate-400 text-base leading-relaxed">
                  ZipAlert bridges physical fire panels, building management triggers, and standalone smartwatches into a secure, zero-latency crisis network. Designed to pierce noise-canceling headphones and protect vulnerable lives.
                </p>
              </div>

              {/* FEATURES GRID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 font-sans">
                <div className="glass-panel p-5 rounded-2xl border-white/5 space-y-2">
                  <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-cyan-400" />
                  </div>
                  <h4 className="font-bold text-white text-sm uppercase tracking-wider">Zero-Battery Standby</h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    Edge Service Workers and FCM wake devices only when an active crisis is tripped, consuming 0% idle battery and $0.00 in database costs.
                  </p>
                </div>

                <div className="glass-panel p-5 rounded-2xl border-white/5 space-y-2">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-emerald-400" />
                  </div>
                  <h4 className="font-bold text-white text-sm uppercase tracking-wider">Tactile Haptic Overrides</h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    Continuous heavy vibration pulses designed specifically to pierce headphones and alert neurodivergent, deaf, and hard of hearing users instantly.
                  </p>
                </div>

                <div className="glass-panel p-5 rounded-2xl border-white/5 space-y-2">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                    <VolumeX className="w-5 h-5 text-indigo-400" />
                  </div>
                  <h4 className="font-bold text-white text-sm uppercase tracking-wider">Selective Alert Routing</h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    Muted operational corridor alerts (Holds/Soft Lockdowns) are routed silently to teachers' wearables while student phones remain dark.
                  </p>
                </div>

                <div className="glass-panel p-5 rounded-2xl border-white/5 space-y-2">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                    <Cpu className="w-5 h-5 text-purple-400" />
                  </div>
                  <h4 className="font-bold text-white text-sm uppercase tracking-wider">Physical IoT Ingestion</h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    Secure SHA-256 HMAC protected Cloudflare Page API webhooks immediately trip critical evacuation states when fire panels drop loop contacts.
                  </p>
                </div>
              </div>

              {/* STATS BANNER */}
              <div className="flex items-center gap-8 border-t border-white/5 pt-6 text-slate-400 font-mono text-xs">
                <div>
                  <strong className="text-white text-lg font-black block tracking-tight">0.0ms</strong>
                  <span>Cold Start Latency</span>
                </div>
                <div className="w-px h-8 bg-white/5" />
                <div>
                  <strong className="text-white text-lg font-black block tracking-tight">100%</strong>
                  <span>Edge-Native Uptime</span>
                </div>
                <div className="w-px h-8 bg-white/5" />
                <div>
                  <strong className="text-white text-lg font-black block tracking-tight">20,000+</strong>
                  <span>Capacity / School</span>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: GLASSMORPHIC ENROLLMENT PORTAL */}
            <div className="lg:col-span-5">
              <div className="glass-panel p-8 rounded-3xl space-y-6 border-white/10 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-cyan-500/10 transition-colors duration-500" />
                
                {!currentUser ? (
                  <>
                    <div className="text-center space-y-4 py-4">
                      <div className="w-16 h-16 bg-cyan-500/10 rounded-2xl mx-auto flex items-center justify-center border border-cyan-500/20 shadow-inner shadow-cyan-500/10 animate-pulse">
                        <ShieldAlert className="w-8 h-8 text-cyan-400" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-2xl font-black text-white tracking-wide uppercase">Roster Verification</h3>
                        <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
                          ZipAlert enforces strict multi-tenant roster boundaries. Please authenticate with your Google identity to establish secure standby connection credentials.
                        </p>
                      </div>
                    </div>

                    {enrollmentError && (
                      <div className="p-3.5 bg-red-950/30 border border-red-500/25 text-red-400 text-xs rounded-xl flex items-center gap-2.5 animate-pulse text-left font-sans">
                        <XCircle className="w-4.5 h-4.5 text-red-400 shrink-0" />
                        <span className="font-semibold">{enrollmentError}</span>
                      </div>
                    )}

                    <button
                      onClick={handleGoogleSignInAction}
                      className="w-full py-4 bg-white hover:bg-slate-100 text-slate-950 text-sm font-black rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-3 cursor-pointer shadow-lg shadow-white/5 uppercase tracking-wide border-0 font-sans cursor-pointer"
                    >
                      <Globe className="w-5 h-5 text-slate-900 shrink-0" />
                      <span>Continue with Google</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-center space-y-2">
                      <div className="w-12 h-12 bg-cyan-500/10 rounded-xl mx-auto flex items-center justify-center border border-cyan-500/20 shadow-inner">
                        <UserPlus className="w-6 h-6 text-cyan-400" />
                      </div>
                      <h3 className="text-2xl font-black text-white tracking-wide uppercase">Link Account</h3>
                      <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
                        Enter your school-issued 6-digit invitation code to associate your Google account with the crisis network roster.
                      </p>
                    </div>

                    <form onSubmit={handleSelfEnrollment} className="space-y-4 font-sans text-left">
                      {enrollmentError && (
                        <div className="p-3.5 bg-red-950/30 border border-red-500/25 text-red-400 text-xs rounded-xl flex items-center gap-2.5 animate-pulse">
                          <XCircle className="w-4.5 h-4.5 text-red-400 shrink-0" />
                          <span className="font-semibold">{enrollmentError}</span>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Google Identity</label>
                        <input 
                          type="text" 
                          disabled
                          value={currentUser.email || ""}
                          className="w-full px-4 py-3 bg-white/[0.02] border border-white/5 rounded-xl text-slate-400 text-sm focus:outline-none cursor-not-allowed"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">6-Digit Invitation Code</label>
                        <div className="relative">
                          <Key className="absolute left-4 top-3.5 w-4 h-4 text-slate-500" />
                          <input 
                            type="text" 
                            maxLength={6}
                            placeholder="e.g. XF89A1"
                            value={enrollmentCode}
                            onChange={(e) => setEnrollmentCode(e.target.value.toUpperCase())}
                            className="w-full pl-11 pr-4 py-3 bg-[#090a10] border border-white/10 focus:border-cyan-500 rounded-xl text-white text-sm font-mono placeholder:text-slate-600 focus:outline-none transition-colors"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Your Full Name</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Miles Brody"
                          value={enrollmentName}
                          onChange={(e) => setEnrollmentName(e.target.value)}
                          className="w-full px-4 py-3 bg-[#090a10] border border-white/10 focus:border-cyan-500 rounded-xl text-white text-sm placeholder:text-slate-600 focus:outline-none transition-colors"
                        />
                      </div>

                      <button 
                        type="submit"
                        className="w-full py-4 mt-2 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-sm font-bold text-white shadow-lg shadow-cyan-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 uppercase tracking-wide border-0 cursor-pointer"
                      >
                        <UserCheck className="w-4 h-4 text-white" /> Enroll Device
                      </button>
                    </form>

                    <div className="border-t border-white/5 pt-4 text-center">
                      <button 
                        onClick={handleSignOut}
                        className="text-xs text-red-400 hover:text-red-300 font-semibold bg-transparent border-0 cursor-pointer uppercase tracking-wider font-mono"
                      >
                        Cancel & Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (

          /* ------------------ ACTIVE VIEW ROUTING ------------------ */
          <div className="w-full">
            
            {/* ------------------ SUPER ADMIN DASHBOARD ------------------ */}
            {activeRole === "SUPER_ADMIN" && (
              <div className="space-y-8 animate-fadeIn">
                
                {/* Super Admin Tab Bar */}
                <div className="flex items-center gap-1 border-b border-white/5 pb-2">
                  <button 
                    onClick={() => setSuperAdminTab("DISTRICTS")}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${superAdminTab === "DISTRICTS" ? "border-emerald-500 text-emerald-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    School Districts Directory
                  </button>
                  <button 
                    onClick={() => setSuperAdminTab("LICENSES")}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${superAdminTab === "LICENSES" ? "border-emerald-500 text-emerald-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    Licensing allocations
                  </button>
                  <button 
                    onClick={() => setSuperAdminTab("GLOBAL_METRICS")}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${superAdminTab === "GLOBAL_METRICS" ? "border-emerald-500 text-emerald-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    Global SaaS Telemetry
                  </button>
                </div>

                {/* TAB 1: DISTRICTS */}
                {superAdminTab === "DISTRICTS" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    
                    {/* Districts list */}
                    <div className="lg:col-span-2 space-y-6">
                      <div className="glass-panel p-6 rounded-3xl space-y-6">
                        <div>
                          <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Layers className="w-6 h-6 text-emerald-400 animate-pulse" />
                            Registered School Districts
                          </h3>
                          <p className="text-slate-400 text-sm mt-1">Super administrative list of school systems. Groups multiple schools under active contracts.</p>
                        </div>

                        <div className="overflow-x-auto font-mono text-xs">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="border-b border-white/5 text-slate-400 uppercase tracking-wider">
                                <th className="py-3 px-4">District ID</th>
                                <th className="py-3 px-4">District Name</th>
                                <th className="py-3 px-4">State</th>
                                <th className="py-3 px-4">Schools</th>
                                <th className="py-3 px-4">Registered Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {districts.map((d) => (
                                <tr key={d.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                  <td className="py-3.5 px-4 text-emerald-400 font-bold">{d.id}</td>
                                  <td className="py-3.5 px-4 text-white font-medium">{d.name}</td>
                                  <td className="py-3.5 px-4 text-slate-300">{d.state}</td>
                                  <td className="py-3.5 px-4 font-bold text-slate-300">🏢 {d.schoolsCount} Schools</td>
                                  <td className="py-3.5 px-4 text-slate-400">{d.createdAt}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Create District */}
                    <div className="glass-panel p-6 rounded-3xl space-y-6 h-fit">
                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <Globe className="w-5 h-5 text-emerald-400" />
                          Create New District
                        </h3>
                        <p className="text-slate-400 text-xs mt-1">Instantiate a new school system entity inside the multi-tenant SaaS schema.</p>
                      </div>

                      <form onSubmit={handleCreateDistrict} className="space-y-4 font-sans text-sm">
                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">District Name</label>
                          <input 
                            type="text"
                            placeholder="e.g. Springfield District 186"
                            value={newDistrictName}
                            onChange={(e) => setNewDistrictName(e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">State Region</label>
                          <input 
                            type="text"
                            placeholder="e.g. IL"
                            maxLength={2}
                            value={newDistrictState}
                            onChange={(e) => setNewDistrictState(e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono"
                          />
                        </div>

                        <button 
                          type="submit"
                          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/10"
                        >
                          <Globe className="w-3.5 h-3.5 text-white" /> Register District
                        </button>
                      </form>
                    </div>

                  </div>
                )}

                {/* TAB 2: LICENSES */}
                {superAdminTab === "LICENSES" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    
                    {/* License table */}
                    <div className="lg:col-span-2 space-y-6">
                      <div className="glass-panel p-6 rounded-3xl space-y-6">
                        <div>
                          <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Award className="w-6 h-6 text-emerald-400 animate-pulse" />
                            Allocated Licensing Contracts
                          </h3>
                          <p className="text-slate-400 text-sm mt-1">Issue contracts, specify school thresholds, device capacity counts, and expiration dates.</p>
                        </div>

                        <div className="overflow-x-auto font-mono text-xs">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="border-b border-white/5 text-slate-400 uppercase tracking-wider">
                                <th className="py-3 px-4">License ID</th>
                                <th className="py-3 px-4">District ID</th>
                                <th className="py-3 px-4">Tier Plan</th>
                                <th className="py-3 px-4">Quotas (Schools / Devices)</th>
                                <th className="py-3 px-4">Status</th>
                                <th className="py-3 px-4 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {licenses.map((lic) => (
                                <tr key={lic.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                  <td className="py-3.5 px-4 text-emerald-400 font-bold">{lic.id}</td>
                                  <td className="py-3.5 px-4 text-white">{lic.districtId}</td>
                                  <td className="py-3.5 px-4">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${lic.planType === "PREMIUM_ENTERPRISE" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "bg-slate-500/10 text-slate-400 border border-white/5"}`}>
                                      {lic.planType}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4 text-slate-300">
                                    Max {lic.maxSchools} schools / <strong className="text-cyan-400">{lic.maxDevicesPerSchool}</strong> devs per school
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      lic.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : 
                                      "bg-red-500/10 text-red-400 border border-red-500/20"
                                    }`}>
                                      {lic.status}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4 text-right">
                                    <button
                                      onClick={() => toggleLicenseStatus(lic.id)}
                                      className={`px-2 py-1 rounded text-[10px] font-sans font-semibold border ${
                                        lic.status === "ACTIVE" 
                                          ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20" 
                                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                                      }`}
                                    >
                                      {lic.status === "ACTIVE" ? "Suspend" : "Activate"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Allocate License Form */}
                    <div className="glass-panel p-6 rounded-3xl space-y-6 h-fit">
                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <Award className="w-5 h-5 text-emerald-400" />
                          Issue New License
                        </h3>
                        <p className="text-slate-400 text-xs mt-1">Allocate licensing capacity, define maximum devices, and bind to a district.</p>
                      </div>

                      <form onSubmit={handleAllocateLicense} className="space-y-4 font-sans text-sm">
                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">Target District</label>
                          <select 
                            value={newLicenseDistrict}
                            onChange={(e) => setNewLicenseDistrict(e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 text-xs"
                          >
                            {districts.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">Contract Plan Tier</label>
                          <select 
                            value={newLicensePlan}
                            onChange={(e) => setNewLicensePlan(e.target.value as any)}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 text-xs"
                          >
                            <option value="PREMIUM_ENTERPRISE">Premium Enterprise Plan</option>
                            <option value="FREE">Standard Free Tier Plan</option>
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[11px] font-mono text-slate-400 uppercase">Max Schools</label>
                            <input 
                              type="number"
                              value={newLicenseSchools}
                              onChange={(e) => setNewLicenseSchools(parseInt(e.target.value))}
                              className="w-full px-4 py-2 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 text-xs font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-mono text-slate-400 uppercase">Max Devs / School</label>
                            <input 
                              type="number"
                              value={newLicenseDevices}
                              onChange={(e) => setNewLicenseDevices(parseInt(e.target.value))}
                              className="w-full px-4 py-2 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 text-xs font-mono"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">Contract Expiration</label>
                          <input 
                            type="date"
                            value={newLicenseExpires}
                            onChange={(e) => setNewLicenseExpires(e.target.value)}
                            className="w-full px-4 py-2 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 text-xs font-mono"
                          />
                        </div>

                        <button 
                          type="submit"
                          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/10"
                        >
                          <Award className="w-3.5 h-3.5 text-white" /> Allocate Contract
                        </button>
                      </form>
                    </div>

                  </div>
                )}

                {/* TAB 3: GLOBAL METRICS */}
                {superAdminTab === "GLOBAL_METRICS" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fadeIn">
                    
                    <div className="glass-panel p-6 rounded-3xl flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <Globe className="w-6 h-6 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-[11px] font-mono text-slate-400 uppercase">Active Districts</p>
                        <h4 className="text-2xl font-black text-white mt-1">{districts.length} Mapped</h4>
                      </div>
                    </div>

                    <div className="glass-panel p-6 rounded-3xl flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                        <Award className="w-6 h-6 text-cyan-400" />
                      </div>
                      <div>
                        <p className="text-[11px] font-mono text-slate-400 uppercase">Active Licenses</p>
                        <h4 className="text-2xl font-black text-white mt-1">{licenses.filter(l=>l.status==="ACTIVE").length} Mapped</h4>
                      </div>
                    </div>

                    <div className="glass-panel p-6 rounded-3xl flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                        <Database className="w-6 h-6 text-indigo-400" />
                      </div>
                      <div>
                        <p className="text-[11px] font-mono text-slate-400 uppercase">Total Linked Schools</p>
                        <h4 className="text-2xl font-black text-white mt-1">22 Mapped</h4>
                      </div>
                    </div>

                    <div className="glass-panel p-6 rounded-3xl flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                        <ShieldAlert className="w-6 h-6 text-red-400" />
                      </div>
                      <div>
                        <p className="text-[11px] font-mono text-slate-400 uppercase">Ongoing Incidents</p>
                        <h4 className="text-2xl font-black text-white mt-1">0 Active</h4>
                      </div>
                    </div>

                  </div>
                )}

              </div>
            )}

            {/* ------------------ ADMIN INTERFACE ------------------ */}
            {activeRole === "ADMIN" && (
              <div className="space-y-8 animate-fadeIn">
                
                {/* Admin Tab Bar */}
                <div className="flex items-center gap-1 border-b border-white/5 pb-2">
                  <button 
                    onClick={() => setAdminTab("CRISIS")}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${adminTab === "CRISIS" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    Crisis Control
                  </button>
                  <button 
                    onClick={() => setAdminTab("ROSTER")}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${adminTab === "ROSTER" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    School Member Roster
                  </button>
                  <button 
                    onClick={() => setAdminTab("DEVICES")}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${adminTab === "DEVICES" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    Hardware Devices
                  </button>
                  <button 
                    onClick={() => setAdminTab("SCHOOL_SETTINGS")}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${adminTab === "SCHOOL_SETTINGS" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    School Settings
                  </button>
                </div>

                {/* TAB 1: CRISIS CONSOLE */}
                {adminTab === "CRISIS" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                      <div className="glass-panel p-6 md:p-8 rounded-3xl space-y-6">
                        <div>
                          <h2 className="text-2xl font-black text-white flex items-center gap-2">
                            <ShieldAlert className="text-cyan-400 w-6 h-6 animate-pulse" />
                            CRISIS CONTROL CONSOLE
                          </h2>
                          <p className="text-slate-400 text-sm mt-1">Force real-time broadcasts immediately across all multi-tenant displays, companion phones, and native wearables.</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          
                          {/* FIRE ALARM TRIGGER */}
                          <div className="relative group overflow-hidden bg-red-950/20 border border-red-500/30 rounded-2xl p-6 flex flex-col justify-between h-56 transition-all hover:border-red-500/50">
                            <div className="flex justify-between items-start">
                              <Flame className="w-10 h-10 text-red-500" />
                              <span className="text-[10px] font-mono bg-red-500/15 text-red-400 border border-red-500/25 px-2 py-0.5 rounded-full uppercase">Broadcast-All</span>
                            </div>
                            <div>
                              <h4 className="text-lg font-black text-white">FIRE ALARM EMERGENCY</h4>
                              <p className="text-xs text-slate-400 mt-1">Evacuate building immediately. Sounds repeating haptic strobes.</p>
                            </div>
                            
                            <button
                              onMouseDown={() => startTriggerHold("FIRE_ALARM")}
                              onMouseUp={() => cancelTriggerHold("FIRE_ALARM")}
                              onMouseLeave={() => cancelTriggerHold("FIRE_ALARM")}
                              onTouchStart={() => startTriggerHold("FIRE_ALARM")}
                              onTouchEnd={() => cancelTriggerHold("FIRE_ALARM")}
                              className="w-full relative h-12 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider overflow-hidden active:scale-[0.98] transition-transform select-none"
                            >
                              <div 
                                className="absolute left-0 top-0 bottom-0 bg-red-800 confirm-loader"
                                style={{ width: `${fireProgress}%` }}
                              />
                              <span className="relative z-10">{fireProgress > 0 ? `HOLDING (${fireProgress}%)` : "HOLD 2S TO CONFIRM"}</span>
                            </button>
                          </div>

                          {/* HARD LOCKDOWN TRIGGER */}
                          <div className="relative group overflow-hidden bg-yellow-950/20 border border-yellow-500/30 rounded-2xl p-6 flex flex-col justify-between h-56 transition-all hover:border-yellow-500/50">
                            <div className="flex justify-between items-start">
                              <ShieldAlert className="w-10 h-10 text-yellow-500" />
                              <span className="text-[10px] font-mono bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 px-2 py-0.5 rounded-full uppercase">Broadcast-All</span>
                            </div>
                            <div>
                              <h4 className="text-lg font-black text-white">CRITICAL LOCKDOWN</h4>
                              <p className="text-xs text-slate-400 mt-1">Hard threat inside corridor. Max visual overrides and haptics.</p>
                            </div>
                            
                            <button
                              onMouseDown={() => startTriggerHold("LOCKDOWN")}
                              onMouseUp={() => cancelTriggerHold("LOCKDOWN")}
                              onMouseLeave={() => cancelTriggerHold("LOCKDOWN")}
                              onTouchStart={() => startTriggerHold("LOCKDOWN")}
                              onTouchEnd={() => cancelTriggerHold("LOCKDOWN")}
                              className="w-full relative h-12 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-xl text-xs uppercase tracking-wider overflow-hidden active:scale-[0.98] transition-transform select-none"
                            >
                              <div 
                                className="absolute left-0 top-0 bottom-0 bg-yellow-700 confirm-loader"
                                style={{ width: `${lockdownProgress}%` }}
                              />
                              <span className="relative z-10">{lockdownProgress > 0 ? `HOLDING (${lockdownProgress}%)` : "HOLD 2S TO CONFIRM"}</span>
                            </button>
                          </div>

                          {/* SOFT LOCKDOWN (Double-Tap trigger) */}
                          <div 
                            onDoubleClick={() => triggerAlert("SOFT_LOCKDOWN", "Muted Corridor Alert: Secure your room. Do not issue hallway passes.")}
                            className="bg-cyan-950/20 border border-cyan-500/30 hover:border-cyan-500/50 rounded-2xl p-6 flex flex-col justify-between h-56 transition-all cursor-pointer group"
                          >
                            <div className="flex justify-between items-start">
                              <VolumeX className="w-10 h-10 text-cyan-400" />
                              <span className="text-[10px] font-mono bg-cyan-500/15 text-cyan-400 border border-cyan-500/25 px-2 py-0.5 rounded-full uppercase">Staff Only</span>
                            </div>
                            <div>
                              <h4 className="text-lg font-black text-white group-hover:text-cyan-300 transition-colors">SOFT LOCKDOWN / HOLD & SECURE</h4>
                              <p className="text-xs text-slate-400 mt-1">Corridor security concern. Alerts staff quietly without triggering student companion panic.</p>
                            </div>
                            <div className="w-full h-12 bg-cyan-950/80 border border-cyan-500/30 rounded-xl flex items-center justify-center text-[10px] text-cyan-400 uppercase font-mono tracking-wider font-bold group-hover:bg-cyan-900/30">
                              DOUBLE-TAP BOX TO INITIATE
                            </div>
                          </div>

                          {/* SYSTEM RECOVERY RESET */}
                          <div 
                            onClick={resetAlert}
                            className="bg-emerald-950/20 border border-emerald-500/30 hover:border-emerald-500/50 rounded-2xl p-6 flex flex-col justify-between h-56 transition-all cursor-pointer group"
                          >
                            <div className="flex justify-between items-start">
                              <CheckCircle className="w-10 h-10 text-emerald-400" />
                              <span className="text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full uppercase">Global Reset</span>
                            </div>
                            <div>
                              <h4 className="text-lg font-black text-white group-hover:text-emerald-300 transition-colors">ALL CLEAR / SYSTEM RESET</h4>
                              <p className="text-xs text-slate-400 mt-1">Instantly restores database state and silences background wearable vibrators.</p>
                            </div>
                            <button className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider active:scale-[0.98] transition-transform">
                              NORMALIZE SYSTEM STATUS
                            </button>
                          </div>

                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {/* Custom Broadcast Dispatcher */}
                      <div className="glass-panel p-6 rounded-3xl space-y-5 border-white/10 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl -mr-12 -mt-12 group-hover:bg-cyan-500/10 transition-colors duration-500" />
                        
                        <div>
                          <h3 className="text-lg font-black text-white flex items-center gap-2 uppercase tracking-wide">
                            <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
                            Broadcast Custom Alert
                          </h3>
                          <p className="text-slate-400 text-xs mt-1">Send a targeted real-time message with custom instructions directly to all classroom displays, companion phones, and smartwatches.</p>
                        </div>

                        <form onSubmit={handleCustomBroadcastSubmit} className="space-y-4 text-left text-xs font-sans">
                          {successMessage && (
                            <div className="p-3 bg-emerald-950/30 border border-emerald-500/25 text-emerald-400 rounded-xl font-sans flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span className="font-semibold">{successMessage}</span>
                            </div>
                          )}

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Custom Instruction Message</label>
                            <textarea
                              rows={4}
                              placeholder="e.g. Active threat in North Corridor. Evacuate immediately toward the gymnasium assembly point."
                              value={customAlertMessage}
                              onChange={(e) => setCustomAlertMessage(e.target.value)}
                              className="w-full px-4 py-3 bg-[#090a10] border border-white/10 focus:border-cyan-500 rounded-xl text-white text-xs placeholder:text-slate-650 focus:outline-none transition-colors resize-none"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Alert Level</label>
                              <select
                                value={customAlertLevel}
                                onChange={(e) => setCustomAlertLevel(e.target.value as any)}
                                className="w-full px-3 py-3 bg-[#090a10] border border-white/10 focus:border-cyan-500 rounded-xl text-white text-xs focus:outline-none transition-colors"
                              >
                                <option value="LOCKDOWN">Lockdown Strobe</option>
                                <option value="FIRE_ALARM">Fire Evacuation</option>
                                <option value="SOFT_LOCKDOWN">Soft Lockdown</option>
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Target Scope</label>
                              <select
                                value={customAlertTarget}
                                onChange={(e) => setCustomAlertTarget(e.target.value as any)}
                                className="w-full px-3 py-3 bg-[#090a10] border border-white/10 focus:border-cyan-500 rounded-xl text-white text-xs focus:outline-none transition-colors"
                              >
                                <option value="ALL_DEVICES">All Devices</option>
                                <option value="STAFF_ONLY">Staff Only</option>
                              </select>
                            </div>
                          </div>

                          <button 
                            type="submit"
                            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-xs font-bold text-white shadow-lg shadow-cyan-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 uppercase tracking-wide border-0 cursor-pointer"
                          >
                            <ShieldAlert className="w-4 h-4 text-white" /> Dispatch Broadcast
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: MEMBER ROSTER PANEL */}
                {adminTab === "ROSTER" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    
                    {/* Member Roster list */}
                    <div className="lg:col-span-2 space-y-6">
                      <div className="glass-panel p-6 rounded-3xl space-y-6">
                        <div>
                          <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Users className="w-6 h-6 text-cyan-400" />
                            School Members & Staff
                          </h3>
                          <p className="text-slate-400 text-sm mt-1">Manage active teachers, students, and admins enrolled in the school profile database.</p>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs font-mono">
                            <thead>
                              <tr className="border-b border-white/5 text-slate-400 uppercase tracking-wider">
                                <th className="py-3 px-4">Member ID</th>
                                <th className="py-3 px-4">Name</th>
                                <th className="py-3 px-4">Email</th>
                                <th className="py-3 px-4">Role</th>
                                <th className="py-3 px-4">Status</th>
                                <th className="py-3 px-4 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {members.map((m) => (
                                <tr key={m.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                  <td className="py-3.5 px-4 text-cyan-400 font-bold">{m.id}</td>
                                  <td className="py-3.5 px-4 text-white font-medium">{m.name}</td>
                                  <td className="py-3.5 px-4 text-slate-300">{m.email}</td>
                                  <td className="py-3.5 px-4">
                                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                                      m.role === "ADMIN" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" :
                                      m.role === "TEACHER" ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" : 
                                      "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                    }`}>
                                      {m.role}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${m.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                                      {m.status}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4 text-right space-x-2">
                                    <button
                                      onClick={() => toggleMemberStatus(m.id)}
                                      className={`px-2.5 py-1 rounded border text-[10px] font-sans font-semibold transition-all ${
                                        m.status === "ACTIVE" 
                                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20" 
                                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                                      }`}
                                    >
                                      {m.status === "ACTIVE" ? "Suspend" : "Activate"}
                                    </button>
                                    <button
                                      onClick={() => removeMember(m.id)}
                                      className="px-2.5 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 transition-all font-sans font-semibold text-[10px]"
                                    >
                                      Revoke
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Generator Panel */}
                    <div className="space-y-6">
                      
                      {/* Generate Invite Code */}
                      <div className="glass-panel p-6 rounded-3xl space-y-6">
                        <div>
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Key className="w-5 h-5 text-cyan-400" />
                            Enrollment Token Generator
                          </h3>
                          <p className="text-slate-400 text-xs mt-1">Spit out secure, single-use or multi-use 6-digit invitation tokens for self-enrollment portals.</p>
                        </div>

                        <form onSubmit={handleCreateInvitation} className="space-y-4 font-sans text-sm">
                          <div className="space-y-1">
                            <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Role Setting</label>
                            <div className="grid grid-cols-2 gap-2">
                              <button 
                                type="button"
                                onClick={() => setNewInviteRole("STUDENT")}
                                className={`py-2 rounded-xl font-semibold border text-xs transition-all ${newInviteRole === "STUDENT" ? "bg-amber-500/10 text-amber-400 border-amber-500/35" : "bg-white/5 text-slate-400 border-transparent"}`}
                              >
                                Student Invite
                              </button>
                              <button 
                                type="button"
                                onClick={() => setNewInviteRole("TEACHER")}
                                className={`py-2 rounded-xl font-semibold border text-xs transition-all ${newInviteRole === "TEACHER" ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/35" : "bg-white/5 text-slate-400 border-transparent"}`}
                              >
                                Teacher Invite
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Maximum Total Uses</label>
                            <input 
                              type="number"
                              min="1"
                              max="1000"
                              value={newInviteUses}
                              onChange={(e) => setNewInviteUses(parseInt(e.target.value))}
                              className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500 font-mono text-xs"
                            />
                          </div>

                          <button 
                            type="submit"
                            className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-cyan-600/10"
                          >
                            <Key className="w-3.5 h-3.5 text-white" /> Create Invitation Code
                          </button>
                        </form>
                      </div>

                      {/* Invitations log */}
                      <div className="glass-panel p-6 rounded-3xl space-y-4">
                        <h4 className="text-xs font-mono text-slate-300 uppercase tracking-wider flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" /> Active Invitation codes
                        </h4>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto font-mono text-xs">
                          {invitations.map((inv) => (
                            <div key={inv.code} className="p-3 bg-[#0d0e17] border border-white/5 rounded-xl flex items-center justify-between">
                              <div>
                                <p className="text-white font-bold text-sm tracking-wider">{inv.code}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">Role: <strong className={inv.role === "TEACHER" ? "text-indigo-400" : "text-amber-400"}>{inv.role}</strong></p>
                              </div>
                              <div className="text-right">
                                <p className="text-slate-300 font-bold">{inv.usedCount}/{inv.maxUses} used</p>
                                <p className="text-[9px] text-slate-500">Exp: {inv.expiresAt.split("T")[0]}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>
                )}

                {/* TAB 3: HARDWARE DEVICES */}
                {adminTab === "DEVICES" && (
                  <div className="glass-panel p-6 rounded-3xl space-y-6 animate-fadeIn">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                          <Smartphone className="w-6 h-6 text-cyan-400" />
                          Registered Hardware Nodes
                        </h3>
                        <p className="text-slate-400 text-sm mt-1">Check telemetry logs, battery state, and active member bindings of linked smartwatches and displays.</p>
                      </div>
                      
                      {/* Active License Details */}
                      {currentLicense && (
                        <div className="px-4 py-2 bg-cyan-950/20 border border-cyan-500/25 rounded-2xl font-mono text-xs text-right">
                          <p className="text-slate-400">License Quota Limit:</p>
                          <p className="text-white mt-0.5 font-bold">{devices.length} / <span className="text-cyan-400">{currentLicense.maxDevicesPerSchool}</span> Linked Devices</p>
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto font-mono text-xs">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-white/5 text-slate-400 uppercase tracking-wider">
                            <th className="py-3 px-4">Device ID</th>
                            <th className="py-3 px-4">Owner (Member ID)</th>
                            <th className="py-3 px-4">Device Name</th>
                            <th className="py-3 px-4">Type</th>
                            <th className="py-3 px-4">Battery Log</th>
                            <th className="py-3 px-4">Registered</th>
                          </tr>
                        </thead>
                        <tbody>
                          {devices.map((d) => {
                            const owner = members.find(m => m.id === d.memberId);
                            return (
                              <tr key={d.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                <td className="py-3.5 px-4 font-bold text-slate-300">{d.id}</td>
                                <td className="py-3.5 px-4 text-white">
                                  {owner ? `${owner.name} (${owner.id})` : `ORPHANED (${d.memberId})`}
                                </td>
                                <td className="py-3.5 px-4 text-slate-300 font-medium">{d.deviceName}</td>
                                <td className="py-3.5 px-4">
                                  <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 text-[10px]">
                                    {d.deviceType}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4 font-bold text-slate-300">
                                  <span className={d.batteryLevel > 30 ? "text-emerald-400" : "text-red-400 animate-pulse"}>
                                    🔋 {d.batteryLevel}%
                                  </span>
                                </td>
                                <td className="py-3.5 px-4 text-slate-400">{d.registeredAt}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB 4: SCHOOL SETTINGS */}
                {adminTab === "SCHOOL_SETTINGS" && (
                  <div className="max-w-2xl glass-panel p-8 rounded-3xl space-y-6 animate-fadeIn">
                    <div>
                      <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Settings className="w-6 h-6 text-cyan-400" />
                        School Management & Configuration
                      </h3>
                      <p className="text-slate-400 text-sm mt-1">Configure multi-tenant environment, administrative accounts, and emergency routing overrides.</p>
                    </div>

                    <form onSubmit={handleUpdateSchoolSettings} className="space-y-6 font-sans text-sm">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">School Name</label>
                          <input 
                            type="text"
                            value={school.name}
                            onChange={(e) => setSchool({ ...school, name: e.target.value })}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">District Timezone</label>
                          <input 
                            type="text"
                            value={school.settings.timezone}
                            onChange={(e) => setSchool({ ...school, settings: { ...school.settings, timezone: e.target.value } })}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">Silent Drill Hours Start</label>
                          <input 
                            type="time"
                            value={school.settings.silentHoursStart}
                            onChange={(e) => setSchool({ ...school, settings: { ...school.settings, silentHoursStart: e.target.value } })}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500 font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-slate-400 uppercase">Silent Drill Hours End</label>
                          <input 
                            type="time"
                            value={school.settings.silentHoursEnd}
                            onChange={(e) => setSchool({ ...school, settings: { ...school.settings, silentHoursEnd: e.target.value } })}
                            className="w-full px-4 py-2.5 bg-[#0d0e17] border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500 font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-[#090b14] rounded-xl border border-white/5">
                        <div>
                          <p className="text-white font-bold">Allow Student Self-Enrollment</p>
                          <p className="text-xs text-slate-400 mt-0.5">Controls if students can autonomously create records using codes.</p>
                        </div>
                        <input 
                          type="checkbox"
                          checked={school.settings.allowStudentSelfEnrollment}
                          onChange={(e) => setSchool({ ...school, settings: { ...school.settings, allowStudentSelfEnrollment: e.target.checked } })}
                          className="w-5 h-5 accent-cyan-500"
                        />
                      </div>

                      <button 
                        type="submit"
                        className="px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors flex items-center gap-1.5 shadow-md shadow-cyan-600/10"
                      >
                        Commit Firestore Settings
                      </button>
                    </form>
                  </div>
                )}

              </div>
            )}

            {/* ------------------ TEACHER HUB INTERFACE ------------------ */}
            {activeRole === "TEACHER" && (
              <div className="animate-fadeIn max-w-3xl mx-auto w-full">
                
                {/* 1. Check if school license has expired or is suspended */}
                {isLicenseViolated() ? (
                  <div className="glass-panel p-8 rounded-3xl text-center space-y-6 border-red-500/50">
                    <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full mx-auto flex items-center justify-center animate-pulse">
                      <XCircle className="w-8 h-8 text-red-500 animate-spin" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">District License Inactive</h3>
                      <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
                        Highland Prep's active service license has been <strong className="text-red-400">SUSPENDED</strong> or has expired. All real-time crisis notification streams have been locked down.
                      </p>
                      <p className="text-xs text-slate-500 font-mono mt-4">Contact System Administrator for SaaS subscription renewals.</p>
                    </div>
                  </div>
                ) : activeMember?.status !== "ACTIVE" ? (
                  <div className="glass-panel p-8 rounded-3xl text-center space-y-6 border-red-500/50">
                    <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full mx-auto flex items-center justify-center">
                      <XCircle className="w-8 h-8 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">Access Revoked</h3>
                      <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
                        Your teacher membership record is currently marked <strong className="text-red-400">SUSPENDED</strong> by Highland Prep administrators. Devices linked to this profile have had Firestore listeners shut down.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className={`glass-panel p-8 rounded-3xl space-y-8 transition-all duration-500 ${
                    currentAlert.status === "SOFT_LOCKDOWN" ? "border-cyan-500/80 bg-cyan-950/10 shadow-[0_0_50px_rgba(6,182,212,0.15)] ring-2 ring-cyan-500 animate-pulse-cyan" : 
                    currentAlert.status === "LOCKDOWN" ? "border-yellow-500/80 bg-yellow-950/10 shadow-[0_0_50px_rgba(234,179,8,0.15)] ring-2 ring-yellow-500 animate-pulse" :
                    currentAlert.status === "FIRE_ALARM" ? "border-red-500/80 bg-red-950/10 shadow-[0_0_50px_rgba(239,68,68,0.15)] ring-2 ring-red-500 animate-pulse" : 
                    "border-white/5"
                  }`}>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-indigo-400 uppercase tracking-widest bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-full flex items-center gap-1.5">
                        <Tv className="w-3.5 h-3.5" /> Classroom Display Node ({activeMember.name})
                      </span>
                      <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 animate-spin" /> Live Snapshot Sync
                      </span>
                    </div>

                    {currentAlert.status === "NORMAL" ? (
                      <div className="text-center py-12 space-y-6">
                        <div className="w-20 h-20 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                          <CheckCircle className="w-10 h-10 text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold text-white">Normal School Operations</h3>
                          <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">ZipAlert is listening in the background. Screen wake locks will activate automatically to hold full brightness if a lockdown triggers.</p>
                        </div>
                      </div>
                    ) : currentAlert.status === "SOFT_LOCKDOWN" ? (
                      <div className="space-y-6">
                        <div className="flex items-center gap-4 bg-cyan-950/30 border border-cyan-500/30 p-5 rounded-2xl">
                          <VolumeX className="w-12 h-12 text-cyan-400 shrink-0 animate-bounce" />
                          <div>
                            <h4 className="text-lg font-black text-cyan-400 uppercase tracking-wide">Muted Corridor Alert (Soft Lockdown)</h4>
                            <p className="text-xs text-cyan-300 font-mono mt-0.5">Alert targeted selectively to Teacher PWAs only. Student devices remain undisturbed.</p>
                          </div>
                        </div>
                        <div className="bg-[#0b0c16] border border-cyan-500/20 p-6 rounded-2xl text-center space-y-4">
                          <p className="text-2xl font-black text-white leading-relaxed">
                            "Secure your room. Do not issue hallway passes."
                          </p>
                          <p className="text-xs text-slate-400 font-mono">
                            Please instruct classroom students to remain seated. Continue instructional lectures as normal.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6 text-center">
                        <div className="p-6 bg-red-950/30 border border-red-500/30 rounded-2xl flex items-center justify-center gap-3">
                          <ShieldAlert className="w-12 h-12 text-red-500 animate-bounce" />
                          <div className="text-left">
                            <h4 className="text-xl font-black text-white uppercase">{currentAlert.status} EMERGENCY</h4>
                            <p className="text-xs text-slate-400 font-mono mt-0.5">Critical broadcast broadcasted across entire school grid.</p>
                          </div>
                        </div>
                        <div className="bg-[#0b0c16] border border-red-500/20 p-8 rounded-2xl space-y-4">
                          <p className="text-3xl font-black text-red-500 leading-tight">
                            {currentAlert.message}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-6 text-xs font-mono text-slate-400">
                      <div>
                        <p>Trigger Origin:</p>
                        <p className="text-white font-semibold mt-1">{currentAlert.triggeredBy}</p>
                      </div>
                      <div>
                        <p>Timestamp:</p>
                        <p className="text-white font-semibold mt-1">{new Date(currentAlert.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* ------------------ STUDENT / PHONE COMPANION PWA ------------------ */}
            {activeRole === "STUDENT" && (
              <div className="animate-fadeIn max-w-sm mx-auto w-full relative">
                
                {/* 1. Check active school license */}
                {isLicenseViolated() ? (
                  <div className="bg-[#090b14] border-4 border-slate-800 rounded-[36px] overflow-hidden shadow-2xl relative flex flex-col justify-between h-[600px]">
                    <div className="bg-[#0c0d18] px-6 py-2.5 flex items-center justify-between text-[11px] font-mono text-red-400 border-b border-white/5">
                      <span>Subscription Inactive</span>
                    </div>
                    <div className="flex-1 p-8 flex flex-col justify-center text-center space-y-6">
                      <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full mx-auto flex items-center justify-center">
                        <XCircle className="w-8 h-8 text-red-500 animate-pulse" />
                      </div>
                      <h4 className="text-lg font-black text-white uppercase">SaaS License Suspended</h4>
                      <p className="text-xs text-slate-400 leading-normal">
                        Your district school contract has been suspended. Companion notifications and localized wearable strobe links are currently deactivated.
                      </p>
                    </div>
                    <div className="bg-[#0c0d18] py-4 flex items-center justify-center border-t border-white/5">
                      <div className="w-28 h-1 bg-slate-700 rounded-full" />
                    </div>
                  </div>
                ) : activeMember?.status !== "ACTIVE" ? (
                  <div className="glass-panel p-8 rounded-3xl text-center space-y-6 border-red-500/50">
                    <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full mx-auto flex items-center justify-center">
                      <XCircle className="w-8 h-8 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">Access Revoked</h3>
                      <p className="text-slate-400 text-sm mt-2">
                        Your student membership has been marked <strong className="text-red-400">SUSPENDED</strong>. All linked wearable channels and notification streams are inactive.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {currentAlert.status === "FIRE_ALARM" && <div className="absolute -inset-4 rounded-[40px] animate-strobe-red -z-10" />}
                    {currentAlert.status === "LOCKDOWN" && <div className="absolute -inset-4 rounded-[40px] animate-strobe-yellow -z-10" />}

                    <div className="bg-[#090b14] border-4 border-slate-800 rounded-[36px] overflow-hidden shadow-2xl relative flex flex-col justify-between h-[600px]">
                      
                      <div className="bg-[#0c0d18] px-6 py-2.5 flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-white/5">
                        <span>ZipAlert Student Phone Companion</span>
                        <span>100% 🔋</span>
                      </div>

                      <div className="flex-1 p-6 flex flex-col justify-between overflow-y-auto">
                        
                        {currentAlert.status === "NORMAL" || currentAlert.status === "SOFT_LOCKDOWN" ? (
                          <div className="flex-1 flex flex-col justify-between py-6">
                            <div className="text-center space-y-4">
                              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto flex items-center justify-center">
                                <CheckCircle className="w-8 h-8 text-emerald-400" />
                              </div>
                              <div>
                                <h4 className="text-lg font-bold text-white">Instructional Time</h4>
                                <p className="text-xs text-slate-400 mt-1.5">Classroom companion active. Soft lockdowns are muted on your device.</p>
                              </div>
                            </div>

                            <div className="bg-[#0d0e17] border border-white/5 p-4 rounded-2xl space-y-3 font-mono text-[11px]">
                              <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                                <Compass className="w-3.5 h-3.5" /> Wearable Push Mirroring
                              </div>
                              <div className="space-y-1.5 text-slate-400">
                                <p className="flex justify-between"><span>Active Watch:</span> <span>Fitbit Gateway</span></p>
                                <p className="flex justify-between"><span>Status:</span> <span className="text-emerald-400">Connected</span></p>
                                <p className="flex justify-between"><span>Expiry TTL:</span> <span className="text-slate-500">{activeMember.expiresAt.split(" ")[0]}</span></p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col justify-between py-4 text-center">
                            <div className="space-y-4">
                              <div className="w-16 h-16 rounded-full bg-white/10 mx-auto flex items-center justify-center animate-ping">
                                <ShieldAlert className="w-8 h-8 text-white" />
                              </div>
                              <h4 className="text-xl font-black text-white uppercase tracking-wider animate-pulse">
                                {currentAlert.status} EMERGENCY
                              </h4>
                            </div>

                            <div className="bg-black/60 border border-white/10 p-5 rounded-2xl space-y-3">
                              <p className="text-sm font-bold text-slate-100 leading-normal">
                                {currentAlert.message}
                              </p>
                              <p className="text-[10px] text-yellow-400 font-mono uppercase tracking-wider animate-pulse">
                                Heavy vibration looped to penetrate noise-canceling headphones.
                              </p>
                            </div>

                            <div className="bg-red-950/20 border border-red-500/20 p-4 rounded-xl font-mono text-[10px] text-red-400 text-left">
                              <p className="font-bold flex items-center gap-1"><Activity className="w-3.5 h-3.5 text-red-400" /> Bluetooth peripheral broadcast</p>
                              <p className="mt-1 text-[9px] text-slate-300">Pushing high-urgency vibration waveforms directly to linked Garmin / Fitbit smartbands...</p>
                            </div>
                          </div>
                        )}

                      </div>

                      <div className="bg-[#0c0d18] py-4 flex items-center justify-center border-t border-white/5">
                        <div className="w-28 h-1 bg-slate-700 rounded-full" />
                      </div>

                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        )}

      </main>
    </div>
  );
}
