/* global importScripts, firebase */
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

const firebaseConfig = Object.fromEntries(new URL(self.location.href).searchParams.entries());

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(payload => {
    const { title, body } = payload.notification || {};
    if (!title) return;
    self.registration.showNotification(title, {
      body,
      icon: '/logo.png',
      badge: '/badge.png',
      data: payload.data,
    });
  });
}

