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

// 3. Initialize App Check immediately after the main app initializes
// utilizing the standard reCAPTCHA v3 site key
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6LcbVRItAAAAAFixIoDhVAI5UJda7HbnTbrwV0Om'),
  isTokenAutoRefreshEnabled: true
});

// 4. Export tools
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const functions = getFunctions(app); 

// 5. Aliases (So your Finishing Floor code keeps working 
// without needing to be rewritten to point to the new 'db')
export const finishingDb = db; 
export const finishingAuth = auth;