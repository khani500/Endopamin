import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId);

const app = isFirebaseConfigured() ? initializeApp(firebaseConfig) : null;

export const getMessagingIfSupported = async () => {
  if (!app || !(await isSupported())) return null;
  return getMessaging(app);
};

export const requestFCMToken = async () => {
  try {
    const messaging = await getMessagingIfSupported();
    if (!messaging) return null;

    let serviceWorkerRegistration;
    if ('serviceWorker' in navigator) {
      const params = new URLSearchParams(
        Object.entries(firebaseConfig).filter(([, value]) => Boolean(value)),
      );
      serviceWorkerRegistration = await navigator.serviceWorker.register(
        `/firebase-messaging-sw.js?${params.toString()}`,
      );
    }

    const token = await getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration,
    });
    return token;
  } catch (err) {
    console.error('FCM token error:', err);
    return null;
  }
};

export const onForegroundMessage = async callback => {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, callback);
};

