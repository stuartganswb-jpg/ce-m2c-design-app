import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions"; 
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// 1. Single source of truth for your project
const firebaseConfig = {
  apiKey: "AIzaSyBnWGjqZXzwMUlRp-8uikDJYW7S9kje5HE",
  authDomain: "ce-m2c-design-collab.firebaseapp.com",
  projectId: "ce-m2c-design-collab",
  storageBucket: "ce-m2c-design-collab.firebasestorage.app",
  messagingSenderId: "166921373356",
  appId: "1:166921373356:web:f435d9de4fc102ea9c4109",
  measurementId: "G-2QQPTMWPFB"
};

// 2. Initialize the app once
const app = initializeApp(firebaseConfig);

// 2a. App Check debug token for NON-production hosts only.
// Vercel preview URLs and localhost aren't on the reCAPTCHA allowed-domains list,
// so reCAPTCHA can't mint an App Check token and PIN auth (enforceAppCheck on
// authenticatePin) fails. On those hosts we present a registered App Check DEBUG
// token instead. This gate never fires on the production domain (bare *.vercel.app
// alias or a custom domain), so production keeps real reCAPTCHA App Check.
const acHost = typeof window !== 'undefined' ? window.location.hostname : '';
const acIsLocal = acHost === 'localhost' || acHost === '127.0.0.1';
// Vercel previews always contain a "-git-<branch>-" segment or an 8+ char deploy
// hash; the production alias / custom domain contains neither.
const acIsPreview = acHost.endsWith('.vercel.app') && (acHost.includes('-git-') || /-[a-z0-9]{8,}-/.test(acHost));
if (acIsLocal || acIsPreview) {
  window.FIREBASE_APPCHECK_DEBUG_TOKEN = 'd3b8f1a2-7c4e-4b9a-9f2d-1e6a5c8b0f33';
}

// 3. Initialize App Check immediately after the main app initializes
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6LcbVRItAAAAAFixIoDhVAI5UJda7HbnTbrwV0Om'),
  isTokenAutoRefreshEnabled: true
});

// 4. Export tools
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const functions = getFunctions(app); 

// 5. Aliases (So your Finishing Floor code keeps working)
export const finishingDb = db; 
export const finishingAuth = auth;