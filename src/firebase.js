import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBnWGjqZXzwMUlRp-8uikDJYW7S9kje5HE",
  authDomain: "ce-m2c-design-collab.firebaseapp.com",
  projectId: "ce-m2c-design-collab",
  storageBucket: "ce-m2c-design-collab.firebasestorage.app",
  messagingSenderId: "166921373356",
  appId: "1:166921373356:web:f435d9de4fc102ea9c4109",
  measurementId: "G-2QQPTMWPFB"
};

// Initialize the "Engine"
const app = initializeApp(firebaseConfig);

// Export the specific tools we need for the shop app
export const db = getFirestore(app);      // The Database (Pins/Chat)
export const storage = getStorage(app);    // The Vault (Sketches/PDFs)
export const auth = getAuth(app);          // The Gatekeeper (Logins)