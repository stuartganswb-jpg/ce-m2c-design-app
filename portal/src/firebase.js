// Client portal Firebase wiring — SAME project as the factory app, but this bundle deliberately
// imports ONLY auth + functions. There is no Firestore or Storage SDK here: portal accounts carry
// a 'customer' claim that the security rules deny everywhere, and every read goes through the
// portal BFF Cloud Functions, which return sanitized payloads.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyBnWGjqZXzwMUlRp-8uikDJYW7S9kje5HE',
  authDomain: 'ce-m2c-design-collab.firebaseapp.com',
  projectId: 'ce-m2c-design-collab',
  storageBucket: 'ce-m2c-design-collab.firebasestorage.app',
  messagingSenderId: '166921373356',
  appId: '1:166921373356:web:f435d9de4fc102ea9c4109',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);
