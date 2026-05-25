// Welcome Voice Service — Endopamin
// Generates personalized, American-slang coach messages based on user profile

const HOUR = new Date().getHours();

// ─── Slang pools by character ────────────────────────────────────────────────

const MESSAGES = {
  maya: { // High energy hype beast
    morning: [
      "Wakey wakey! Time to secure that bag and get your morning pump. No cap, today hits different. 💪",
      "Rise and grind! Your future self is already at the gym waiting on you. Don't be that guy. ☀️",
      "Yo {name}! Up and at 'em — the gains don't wait and neither do I. Let's get after it! 🔥",
      "Good morning bestie! Beds are for sleeping, gyms are for winning. Which one you choosing? 👀",
    ],
    afternoon: [
      "Ayo {name}, stop scrolling and start lifting! You're either glowing up or slowing down. 🚀",
      "Midday check! Are we locking in today or what? The grind don't stop at noon. 💥",
      "No cap {name} — every rep you skip, someone else is doing. Get moving! 🔥",
      "Lunch break = gym break. Real ones know. Let's gooo! 💪",
    ],
    evening: [
      "Evening sesh hits different {name}! Night owls get gains too. Let's cook! 🌙",
      "The day ain't over till you move that body. Come on {name}, one more push! ⚡",
      "Gym's still open and so are your excuses. Drop both. Let's go! 🎯",
    ],
    missed_1: [
      "Bro {name}, you ghosted yesterday! We don't do that here. Come back and we'll fix it. 👻",
      "One day off is rest. Two is a habit. Which one is this {name}? 👀",
    ],
    missed_3: [
      "{name} where you been?! Your muscles are literally texting me asking about you. 😂💪",
      "3 days MIA {name}. The gym has a missing poster up. Come back, no judgment. 🙏",
    ],
    missed_7: [
      "Okay {name}, real talk. A week is too long. I'm not mad, just bring yourself back. 💙",
      "{name} — your streak is gone but your potential isn't. Fresh start TODAY. Let's run it back. 🔄",
    ],
    streak: [
      "{streak} days straight?! {name} you're built different fr fr. Don't stop now! 🏆",
      "On a {streak}-day streak?! Bro {name} is locked IN. Elite behavior. 🔥",
    ],
    goal_fat_loss: "Burning that fat one rep at a time {name}! Body recomp szn is NOW. 🔥",
    goal_muscle: "Stack those gains {name}! Muscle don't build itself — let's get to work. 💪",
    goal_strength: "Getting stronger every day {name}! Power up, no cap. ⚡",
  },

  rex: { // Military precision, no-nonsense
    morning: [
      "0600 hours {name}. Soldiers don't sleep in. Move it. 🎯",
      "Morning report: your body needs orders. I'm giving them. Get up. 💪",
      "{name}. Up. Dressed. Moving. In that order. No debates. 🏋️",
      "The weak are still in bed. You're not weak. Prove it {name}. ⚡",
    ],
    afternoon: [
      "1300 hours. Midday slump is for amateurs. You're not an amateur {name}. Move. 🎯",
      "Progress report needed {name}. Have you trained today? Yes or no. 💪",
      "Stop. Drop the phone. Pick up the weights. Execute. 🔥",
    ],
    evening: [
      "End of day assessment {name}. Did you earn your rest today? ⚡",
      "Night session. Real discipline shows when nobody's watching. Let's see it {name}. 🌙",
      "2100 hours. One more push before lights out {name}. Non-negotiable. 💪",
    ],
    missed_1: [
      "Absence noted {name}. One miss is allowed. Two is a pattern. Don't make it a pattern. 🎯",
      "Yesterday was a write-off {name}. Today is not. Get back on track. Now. ⚡",
    ],
    missed_3: [
      "Three days {name}. That's not a rest period, that's desertion. Report back immediately. 🎯",
      "Status: AWOL for 3 days {name}. I need you back at base. No more delays. 💪",
    ],
    missed_7: [
      "A week gone {name}. I don't do motivational speeches. I do results. Come back. 🔄",
      "{name}. Seven days. New mission starts now. Simple. 🎯",
    ],
    streak: [
      "{streak} days of discipline {name}. This is what separates operators from civilians. Maintain. 🏆",
      "Streak: {streak}. Status: Exceptional. Continue the mission {name}. 🎯",
    ],
    goal_fat_loss: "Body fat is the enemy {name}. We're at war with it daily. Attack. 🔥",
    goal_muscle: "Mass building protocol active {name}. Execute the plan. No shortcuts. 💪",
    goal_strength: "Strength is built through discipline {name}. Every session counts. Move iron. ⚡",
  },

  elias: { // Calm, wise, sustainable
    morning: [
      "Good morning {name}. Your body rested, now let it move. Start slow, start steady. 🌅",
      "A new day {name}. Every morning is a clean slate. What will you build today? ☀️",
      "Morning {name}. Not every session needs to be intense. Just show up, that's everything. 🙏",
      "Rise with intention {name}. A mindful workout beats a forced one every time. 🧘",
    ],
    afternoon: [
      "How's the day treating you {name}? A midday movement break does wonders for the mind. 🌿",
      "Afternoon check-in {name}. Even 20 minutes of movement shifts everything. You got this. ✨",
      "Your body is asking for movement {name}. Listen to it. It knows what it needs. 🌊",
    ],
    evening: [
      "Evening {name}. Whatever happened today — a workout will make you feel better about it. 🌙",
      "Wind down the right way {name}. Move the body, clear the mind. That's the formula. 🧘",
      "Evening session {name}. End the day stronger than you started it. Steady wins. ✨",
    ],
    missed_1: [
      "Yesterday slipped away {name}? That's okay. Today is wide open. 🌅",
      "Missing a day happens {name}. What matters is how quickly you return. Today's good. 🌿",
    ],
    missed_3: [
      "Three days away {name}. Life got busy — I understand. When you're ready, I'm here. 🙏",
      "Hey {name}. No judgment on the three days. Just a gentle nudge to come back. 🌊",
    ],
    missed_7: [
      "{name}, a week away. Starting over feels hard but it's never actually starting over. You remember everything. 🌱",
      "Welcome back whenever you're ready {name}. Your progress waits for you, not the other way around. 🙏",
    ],
    streak: [
      "{streak} days of showing up {name}. Not glamorous, just consistent. That's everything. 🌿",
      "A {streak}-day streak {name}. Built one quiet day at a time. Keep going. ✨",
    ],
    goal_fat_loss: "Sustainable progress {name}. Not a crash, not a sprint. A steady burn that lasts. 🌊",
    goal_muscle: "Building {name}. Brick by brick, session by session. Trust the process. 🌱",
    goal_strength: "Getting stronger takes time {name}. Every rep is an investment. Keep depositing. ✨",
  },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function personalize(text, name, streak = 0) {
  return text
    .replace(/{name}/g, name || 'Champ')
    .replace(/{streak}/g, streak);
}

function getTimeOfDay() {
  if (HOUR >= 5 && HOUR < 12) return 'morning';
  if (HOUR >= 12 && HOUR < 20) return 'afternoon';
  return 'evening';
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function getWelcomeMessage(profile) {
  const persona = profile?.coach_persona || 'elias';
  const name = (profile?.display_name || 'Champ').split(' ')[0];
  const streak = profile?.streak_count || 0;
  const goal = profile?.goal || '';
  const lastActive = profile?.last_active;
  const pool = MESSAGES[persona] || MESSAGES.elias;

  // Calculate days since last active
  let daysMissed = 0;
  if (lastActive) {
    const last = new Date(lastActive);
    const now = new Date();
    daysMissed = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  }

  let raw;

  // Streak celebration
  if (streak >= 3 && daysMissed === 0) {
    raw = pick(pool.streak);
  }
  // Absence messages
  else if (daysMissed >= 7) {
    raw = pick(pool.missed_7);
  } else if (daysMissed >= 3) {
    raw = pick(pool.missed_3);
  } else if (daysMissed === 1) {
    raw = pick(pool.missed_1);
  }
  // Goal-specific
  else if (goal.includes('fat') || goal === 'cut') {
    raw = pool.goal_fat_loss || pick(pool[getTimeOfDay()]);
  } else if (goal.includes('muscle') || goal === 'bulk') {
    raw = pool.goal_muscle || pick(pool[getTimeOfDay()]);
  } else if (goal.includes('strength')) {
    raw = pool.goal_strength || pick(pool[getTimeOfDay()]);
  }
  // Time-based default
  else {
    raw = pick(pool[getTimeOfDay()]);
  }

  return personalize(raw, name, streak);
}

// ─── Speak the message ───────────────────────────────────────────────────────

export function speakWelcome(text, gender = 'male') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text.replace(/[🔥💪⚡🎯🌙🌅☀️🏆🙏🌿✨🌊🌱😂👻👀🚀💥🔄]/gu, ''));
  utter.lang = 'en-US';
  utter.rate = gender === 'female' ? 1.05 : 0.95;
  utter.pitch = gender === 'female' ? 1.1 : 0.9;

  // Try to pick an American English voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.lang === 'en-US' && (v.name.includes('Samantha') || v.name.includes('Alex') || v.name.includes('Google'))
  ) || voices.find(v => v.lang === 'en-US');

  if (preferred) utter.voice = preferred;
  window.speechSynthesis.speak(utter);
}