import { supabase } from '../lib/supabase';
import { requestFCMToken } from '../lib/firebase';

export const registerForNotifications = async userId => {
  if (!userId || typeof Notification === 'undefined') return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const token = await requestFCMToken();
  if (!token) return false;

  if (supabase) {
    await supabase
      .from('notification_settings')
      .upsert({
        user_id: userId,
        fcm_token: token,
      });
  }

  return true;
};

export const sendNotification = (title, body, data = {}) => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: '/logo.png', data });
};

export const getNotificationSettings = async userId => {
  if (!supabase || !userId) return null;

  const { data, error } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load notification settings:', error);
    return null;
  }

  return data;
};

export const NOTIFICATION_TEMPLATES = {
  streakRisk: (name, streak, coachName) => ({
    title: `🔥 ${name}, don't break your ${streak}-day streak!`,
    body: `Coach ${coachName} is waiting. Log your workout before midnight.`,
    type: 'streak_risk',
  }),
  streakBroken: (name, streak, coachName) => ({
    title: `😔 Streak reset, ${name}`,
    body: `${streak} days gone. Coach ${coachName} says: "Champions restart, not quit."`,
    type: 'streak_broken',
  }),
  missedTwoDays: (name, coachName) => ({
    title: `📍 ${name}, it's been 2 days`,
    body: `Coach ${coachName}: "Even 20 minutes counts. Come back today."`,
    type: 'missed_2_days',
  }),
  missedFiveDays: (name, coachName) => ({
    title: `⚠️ We miss you, ${name}`,
    body: `Coach ${coachName}: "Your body is waiting. Let's start fresh — no judgment."`,
    type: 'missed_5_days',
  }),
  morningCoach: (name, coachName, message) => ({
    title: `☀️ Coach ${coachName} has a message`,
    body: message || `Good morning ${name}! Check in and let's plan your day.`,
    type: 'morning_coach',
  }),
  checkInReminder: name => ({
    title: `📊 Daily check-in ready, ${name}`,
    body: 'How are you feeling today? 30 seconds to log your status.',
    type: 'checkin_reminder',
  }),
  groupSession: (sessionName, minutesBefore) => ({
    title: `👥 ${sessionName} starts in ${minutesBefore} min`,
    body: 'Your training partners are getting ready. Tap to join.',
    type: 'group_session',
  }),
  milestone: (name, achievement) => ({
    title: `🏆 Achievement unlocked, ${name}!`,
    body: achievement,
    type: 'milestone',
  }),
  restReminder: name => ({
    title: `💤 Recovery day, ${name}`,
    body: 'Your body needs rest today. Check out the mobility session.',
    type: 'rest_reminder',
  }),
};

