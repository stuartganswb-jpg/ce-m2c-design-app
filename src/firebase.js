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
// The token value is NOT committed — it lives in .env.local (and Vercel preview env)
// as REACT_APP_APPCHECK_DEBUG_TOKEN, because a committed debug token ships in the
// readable bundle and would let anyone mint App Check tokens.
const acHost = typeof window !== 'undefined' ? window.location.hostname : '';
const acIsLocal = acHost === 'localhost' || acHost === '127.0.0.1';
// Vercel previews always contain a "-git-<branch>-" segment or an 8+ char deploy
// hash; the production alias / custom domain contains neither.
const acIsPreview = acHost.endsWith('.vercel.app') && (acHost.includes('-git-') || /-[a-z0-9]{8,}-/.test(acHost));
if ((acIsLocal || acIsPreview) && process.env.REACT_APP_APPCHECK_DEBUG_TOKEN) {
  window.FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.REACT_APP_APPCHECK_DEBUG_TOKEN;
}

// 3. Initialize App Check immediately after the main app initializes
export const appCheck = initializeAppCheck(app, {
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

// 6. OUTER GATE — daily email/password sign-in that fronts the whole portal.
// Firebase Auth holds ONE current user per app instance, and the PIN flow signs in with a
// custom token on the default instance (everything Firestore reads under). So the email
// session lives on a SECOND app instance: PIN switching all day never disturbs it, and the
// per-transaction floor logouts don't force anyone back to the email screen.
const outerApp = initializeApp(firebaseConfig, 'outer-gate');
export const outerAuth = getAuth(outerApp);

// Fresh ID token for the outer email session — authenticatePin requires it before minting a
// PIN token (the PIN is a user-switcher behind the daily login, not a standalone credential).
export const getOuterIdToken = async () => {
  const u = outerAuth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch (e) { return null; }
};