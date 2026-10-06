// Firebase төслийн тохиргоо.
// Firebase Console → Project settings → General → "Your apps" → Web app → SDK setup → "Config" хэсгээс хуулж энд тавина.
// Эдгээр түлхүүр нууц биш (сайтын хөтөч дээр ил байдаг); өгөгдлийг firestore.rules хамгаална.
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "0",
  appId: "YOUR_APP_ID"
};
