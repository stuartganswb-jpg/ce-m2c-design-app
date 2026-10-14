// ⏱ THE TIME CLOCK'S OWN FIREBASE INSTANCE (2026-10-14). A punch signs the person in with their PIN for one moment and signs
// them out again — on a tablet that is also running the finishing floor or the WMS. Firebase Auth holds ONE user per app
// instance and shares it across every tab of the site, so signing in on the default instance would switch the floor app in
// the next tab to whoever just punched, and signing out would log it out. So the clock runs on its OWN instance, as the
// daily email sign-in already does (firebase.js "outer-gate"): its own Auth (in memory only — nothing survives a reload,
// nothing is shared with another tab), its own App Check (Firestore and authenticatePin enforce it), its own Firestore.
import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, inMemoryPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { appCheck, RECAPTCHA_SITE_KEY } from '../../firebase';

const NAME = 'time-clock';
let cached = null;
export function clockFirebase() {
    if (cached) return cached;
    const app = getApps().find(a => a.name === NAME) || initializeApp(appCheck.app.options, NAME);
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
    cached = { app, auth: initializeAuth(app, { persistence: inMemoryPersistence }), db: getFirestore(app), functions: getFunctions(app) };
    return cached;
}
