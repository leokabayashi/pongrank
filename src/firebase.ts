import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    projectId: "pongrank-lkoba",
    appId: "1:270346764966:web:88f2a56bfef7b95230aa67",
    storageBucket: "pongrank-lkoba.firebasestorage.app",
    apiKey: "AIzaSyC8Advr8fLA6FV-kDfNuJgwrkc5jHmvwyI",
    authDomain: "pongrank-lkoba.firebaseapp.com",
    messagingSenderId: "270346764966",
    projectNumber: "270346764966"
};

const app = initializeApp(firebaseConfig);
export const functions = getFunctions(app, "us-central1"); // Ensure region matches
export const db = getFirestore(app);
export { httpsCallable };
