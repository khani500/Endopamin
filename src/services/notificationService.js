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

export const ABSENCE_MESSAGES = {
  day1: [
    { title: '👀 We see you... hiding', body: 'Your streak misses you. Come back before it gets awkward.' },
    { title: '🤔 Did you forget something?', body: "Oh right — your gains. They're waiting." },
    { title: '📱 Your coach called...', body: "Coach said: 'I'm not mad, just disappointed.'" },
  ],
  day2: [
    { title: '😤 Two days? Really?', body: 'Your muscles are literally shrinking. (Okay maybe not, but still.)' },
    { title: '🦥 Sloth mode: ACTIVATED', body: 'Your fitness app is judging you. Gently. But judging.' },
    { title: '⚠️ Streak Alert', body: "Your {streak}-day streak is about to become history. Don't let it." },
  ],
  day5: [
    { title: '🚨 Emergency Broadcast', body: 'This is your gains speaking. We are in DANGER. Please report to gym ASAP.' },
    { title: "💔 It's been 5 days", body: 'Your barbell is covered in dust. Your coach is in therapy. Come back.' },
    { title: '🏳️ We accept your surrender', body: 'Just kidding. Champions come back. Are you a champion?' },
  ],
  motivational: [
    { title: '⚡ One rep is all it takes', body: 'Start with one. The rest follows. You know this.' },
    { title: '🔥 Your streak was {streak} days', body: 'Build it back. Day 1 starts now.' },
    { title: '💪 Coach Maya says:', body: "'COME ON! I BELIEVE IN YOU MORE THAN YOU BELIEVE IN YOURSELF!'" },
  ],
};

export const getAbsenceMessage = (daysMissed, streakCount = 0) => {
  let pool;
  if (daysMissed === 1) pool = ABSENCE_MESSAGES.day1;
  else if (daysMissed <= 3) pool = ABSENCE_MESSAGES.day2;
  else pool = ABSENCE_MESSAGES.day5;

  const msg = pool[Math.floor(Math.random() * pool.length)];
  return {
    title: msg.title.replace('{streak}', streakCount),
    body: msg.body.replace('{streak}', streakCount),
  };
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

