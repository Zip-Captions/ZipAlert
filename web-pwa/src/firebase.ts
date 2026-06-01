import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const apiKey = (import.meta as any).env.VITE_FIREBASE_API_KEY;
const authDomain = (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN;
const projectId = (import.meta as any).env.VITE_FIREBASE_PROJECT_ID;
const storageBucket = (import.meta as any).env.VITE_FIREBASE_STORAGE_BUCKET;
const messagingSenderId = (import.meta as any).env.VITE_FIREBASE_MESSAGING_SENDER_ID;
const appId = (import.meta as any).env.VITE_FIREBASE_APP_ID;

export const isFirebaseConfigured = !!(apiKey && projectId && authDomain && apiKey !== "undefined");

let app: any = null;
let auth: any = null;
let db: any = null;
let googleProvider: any = null;

if (isFirebaseConfigured) {
  const firebaseConfig = {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId
  };

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();

  googleProvider.setCustomParameters({
    prompt: "select_account"
  });
}

export { app, auth, db, googleProvider };
