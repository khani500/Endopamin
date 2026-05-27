import { requestFCMToken, onForegroundMessage } from '../lib/firebase';
import { supabase } from '../lib/supabase';

export async function setupNotifications(userId) {
  if (!('Notification' in window)) return { success: false, reason: 'not_supported' };
  if (Notification.permission === 'denied') return { success: false, reason: 'denied' };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { success: false, reason: 'denied' };

    const token = await requestFCMToken();
    if (!token) return { success: false, reason: 'no_token' };

    await supabase
      .from('profiles')
      .update({ fcm_token: token })
      .eq('id', userId);

    return { success: true, token };
  } catch (err) {
    console.error('Notification setup failed:', err);
    return { success: false, reason: err.message };
  }
}

export async function listenForForegroundMessages(onNotification) {
  return onForegroundMessage(payload => {
    const { title, body } = payload.notification || {};
    if (title && onNotification) onNotification({ title, body });
  });
}

export function isNotificationSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export function getNotificationPermission() {
  if (!('Notification' in window)) return 'not_supported';
  return Notification.permission;
}
