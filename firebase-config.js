// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBpvTJQhyMfh0dO-0Fw8W5BNsQ8-lDGSRs",
  authDomain: "notetaking-58ff9.firebaseapp.com",
  projectId: "notetaking-58ff9",
  storageBucket: "notetaking-58ff9.firebasestorage.app",
  messagingSenderId: "511242096421",
  appId: "1:511242096421:web:577d66c644cf199e75d4cc",
  measurementId: "G-V2X38NDNJJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);