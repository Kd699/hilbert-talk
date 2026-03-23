import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ',
  authDomain: 'hilbert-talk.firebaseapp.com',
  projectId: 'hilbert-talk',
  storageBucket: 'hilbert-talk.firebasestorage.app',
  messagingSenderId: '911714988222',
  appId: '1:911714988222:web:da322ebbeb03aa724feeef',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
