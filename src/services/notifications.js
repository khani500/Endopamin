export const requestNotificationPermission = async () => {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
};

export const sendNotification = (title, body, icon = '/logo.png') => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon });
  }
};

export const notifications = {
  streakReminder: streak => ({
    title: "🔥 Don't break your streak!",
    body: `You have a ${streak}-day streak. Log today's workout.`,
  }),
  morningCoach: coachName => ({
    title: `Coach ${coachName} has a message`,
    body: "Your daily check-in is ready. Tap to see today's plan.",
  }),
  groupSession: (sessionName, time) => ({
    title: `📢 ${sessionName} starts soon`,
    body: `Your group session begins in 30 minutes.${time ? ` (${time})` : ''}`,
  }),
};

