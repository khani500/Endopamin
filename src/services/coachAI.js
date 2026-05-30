import { askGemini, askGeminiChat } from '../lib/gemini';
import {
  buildCoachSystemPrompt,
  sanitizeCoachResponse,
  toGeminiContents,
} from '../lib/coachChat';
import { getCoach } from '../config/coaches';

function firstName(name) {
  return String(name || 'Champion').trim().split(/\s+/)[0] || 'Champion';
}

// Build full context string from user profile
function buildProfileContext(profile = {}, name) {
  const {
    goal, experience, gender, streak_count, dopa_level,
    energy_level, days_per_week, equipment, age, weight, height,
    injuries, session_duration, location, diet,
    coach_persona, created_at,
  } = profile;

  const daysSinceJoined = created_at
    ? Math.floor((Date.now() - new Date(created_at)) / (1000 * 60 * 60 * 24))
    : 0;

  return `
ATHLETE PROFILE (confirmed facts — do not ask again):
- Name: ${name}
- Goal: ${goal || 'general fitness'}
- Experience: ${experience || 'intermediate'}
- Injuries / restrictions: ${injuries || 'none reported'}
- Session duration: ${session_duration || 45} min
- Location: ${location || 'not specified'}
- Equipment: ${Array.isArray(equipment) ? equipment.join(', ') : equipment || 'full gym'}
- Diet: ${diet || 'none specified'}
- Age: ${age || 'unknown'}
- Weight: ${weight ? `${weight}kg` : 'unknown'}
- Height: ${height ? `${height}cm` : 'unknown'}
- Gender: ${gender || 'not specified'}
- Training days/week: ${days_per_week || 3}
- Streak: ${streak_count || 0} days
- Endo level: ${dopa_level || 1}
- Days since joined: ${daysSinceJoined}
`.trim();
}

/** Core chat instructions — merged into buildCoachSystemPrompt via chatWithCoach. */
export const COACH_CHAT_INSTRUCTIONS = `ENDOPAMIN AI — HOW TO REPLY:

IDENTITY: Elite fitness coach. Evidence-based periodization, anatomy-aware, peer-level. Never generic beginner advice.

LANGUAGE: Respond ONLY in fluent, natural, professional English.

ONBOARDING IS DONE:
- ATHLETE PROFILE is confirmed. Do NOT re-ask sleep, energy, medical/surgery history, goals, injuries, equipment, or location each message.
- Only address pain, fatigue, or recovery if the user raises it or reports symptoms today.

PERIODIZATION & SESSION TRACKING:
- Program in 5–6 week blocks adapted to Gym, Home, or Desk environment from profile.
- State session position when prescribing: "Today is Session X of Week Y. Next session is Z."
- Reference streak, last workout, and progress from profile when relevant.

SESSION STRUCTURE (MANDATORY):
- Every prescription: Warm-up (5–10 min) → Main work (sets, reps, rest, RPE) → Cool-down (5 min).
- Progressive overload with safety: no heavy barbell squats or advanced max lifts on day one.
- Match exercise difficulty to experience level in profile.

VOICE & TONE:
- No robotic openers: never start with "Understand", "I understand", "I understand your request", "Got it", or "Certainly".
- Sound like a live coach. Plain text only for TTS — no markdown or bullet formatting.

EXPERT MODE:
- When the user challenges advice or asks about form, anatomy, or programming: answer with precise, professional detail.
- Name muscles, joint actions, common faults, and safe regressions or progressions.`;

// Smart monthly assessment trigger
function shouldTriggerAssessment(profile = {}) {
  const { created_at } = profile;
  if (!created_at) return false;
  const daysSince = Math.floor((Date.now() - new Date(created_at)) / (1000 * 60 * 60 * 24));
  return daysSince > 0 && daysSince % 30 === 0;
}

export const getDailyMessage = async (coachId, userContext) => {
  const coach = getCoach(coachId);
  const { name, streak, level, lastWorkout, goal, energy, gender } = userContext;
  const userName = firstName(name);

  const prompt = `
Generate a personalized daily motivation message for ${userName}.

${buildProfileContext(userContext, userName)}

Rules:
- Do NOT start with "Hey" — vary the opening every time
- Reference their actual stats (streak: ${streak}, level: ${level})
- Keep it under 3 sentences
- Make it feel like you actually know them
- Match your character personality exactly
`.trim();

  try {
    return await askGemini(prompt, coach.personality);
  } catch (error) {
    console.error('Daily message failed:', error);
    const fallbacks = {
      rex: `${userName}. ${streak} days. Do not stop now.`,
      maya: `${userName}! ${streak} days strong — let's make today count!`,
      elias: `${userName}, ${streak} consecutive days of adaptation. Your body is changing. Continue.`,
      zara: `${userName}, ${streak} days in. Your future self is already bragging about you.`,
    };
    return fallbacks[coachId] || fallbacks.rex;
  }
};

export const chatWithCoach = async (coachId, userName, message, conversationHistory = [], profile = {}) => {
  const coach = getCoach(coachId);
  const name = firstName(userName);
  const profileContext = buildProfileContext(profile, name);

  const isAssessmentTime = shouldTriggerAssessment(profile);

  const historyMessages = [
    ...conversationHistory.map(m => ({
      role: m.role === 'coach' || m.role === 'assistant' ? 'assistant' : 'user',
      text: m.content || m.text || '',
    })),
    { role: 'user', text: message },
  ];

  const assessmentNote = isAssessmentTime
    ? `\nIMPORTANT: It has been 30 days since ${name} joined. Proactively bring up a progress assessment and suggest upgrading their plan. Do this naturally within your response, not as a separate announcement.`
    : '';

  const basePrompt = `${coach.personality}

${assessmentNote}

${COACH_CHAT_INSTRUCTIONS}`;

  const systemPrompt = buildCoachSystemPrompt(
    basePrompt,
    { name: coach.name, id: coach.id },
    historyMessages,
    profileContext,
    { preservePersona: coachId === 'kane', profile },
  );

  try {
    const raw = await askGeminiChat({
      messages: toGeminiContents(historyMessages),
      systemPrompt,
    });
    return sanitizeCoachResponse(raw, coach.name);
  } catch (error) {
    console.error('Coach chat failed:', error);
    const fallbacks = {
      rex: `${coach.name}: Connection dropped. Here is your move ${name}: warm up now, first working set in 5 minutes. No waiting.`,
      maya: `${coach.name}: Temporary glitch ${name}! Do not let it stop you — start with what you know!`,
      elias: `${coach.name}: Technical interruption, ${name}. While we reconnect — focus on your breathing and prime your nervous system.`,
      zara: `${coach.name}: The AI gods are testing us ${name}. Classic villain move. Just start moving anyway.`,
    };
    return fallbacks[coachId] || fallbacks.rex;
  }
};

export const getCheckInResponse = async (coachId, userName, energy, sleep, profile = {}) => {
  const coach = getCoach(coachId);
  const name = firstName(userName);
  const profileContext = buildProfileContext(profile, name);

  const prompt = `
${profileContext}

${name} just checked in:
- Energy level: ${energy}/5
- Sleep quality: ${sleep ? 'good' : 'poor'}

Give a coach reply in 3 to 4 sentences max:
- Energy 1-2 or poor sleep: recovery focus with warm-up, light main work, and cool-down
- Energy 3: moderate session with progressive loading and full session structure
- Energy 4-5: performance session with periodization context and session tracking

Plain text only. No markdown. Use profile goal, injuries, and session duration. Do not re-ask onboarding or medical history.
`.trim();

  try {
    return await askGemini(prompt, coach.personality);
  } catch (error) {
    console.error('Check-in failed:', error);
    return `${coach.name}: ${energy <= 2 || !sleep ? `Recovery day ${name}. 10 min mobility: hip circles, thoracic rotation, leg swings. Then done.` : `Let's go ${name}. Warm up 5 min, then execute.`}`;
  }
};

export const generateWorkoutPlan = async (coachId, userProfile) => {
  const coach = getCoach(coachId);
  const { name, goal, experience, daysPerWeek, timeAvailable, injuries, equipment } = userProfile;
  const userName = firstName(name);

  const prompt = `
Create a complete ${daysPerWeek}-day/week workout plan for ${userName}.

Profile:
- Goal: ${goal}
- Experience: ${experience}
- Time per session: ${timeAvailable || '45-60 min'}
- Equipment: ${Array.isArray(equipment) ? equipment.join(', ') : equipment || 'full gym'}
- Injuries/restrictions: ${injuries || 'none'}

Requirements:
- Include EXACT sets, reps, rest periods for every exercise
- Include progression notes (when to increase weight/reps)
- Include warm-up and cool-down
- Scientific reasoning for exercise selection

Return ONLY valid JSON:
{
  "plan": [
    {
      "day": "Monday",
      "type": "Push — Chest/Shoulders/Triceps",
      "duration": 50,
      "warmup": ["5 min light cardio", "arm circles 2x20"],
      "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "6-8", "rest": 90, "cues": "Control the descent, drive through heels", "progression": "Add 2.5kg when you hit 8 reps all sets" }
      ],
      "cooldown": ["chest stretch 30s each side"]
    }
  ],
  "notes": "Coach tip about the overall plan"
}
Return ONLY the JSON, no other text.
`.trim();

  try {
    const response = await askGemini(prompt, coach.personality);
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch (error) {
    console.error('Workout plan failed:', error);
    return null;
  }
};

export const getProgressInsight = async (coachId, userName, metrics, profile = {}) => {
  const coach = getCoach(coachId);
  const name = firstName(userName);

  const { weightChange, workoutsThisWeek, topExercise, streak, daysSinceStart } = metrics;

  const prompt = `
${buildProfileContext(profile, name)}

Progress metrics:
- Weight change: ${weightChange}kg this week
- Workouts completed: ${workoutsThisWeek}/7 days
- Best exercise progress: ${topExercise}
- Current streak: ${streak} days
- Days since start: ${daysSinceStart || 0}

${daysSinceStart >= 30 ? `This is a 30-day milestone assessment. Give a thorough review and concrete plan upgrade.` : `Give one specific insight and one actionable tip.`}

Be specific, reference their actual numbers, and stay in character.
`.trim();

  try {
    return await askGemini(prompt, coach.personality);
  } catch (error) {
    console.error('Progress insight failed:', error);
    return `${coach.name}: ${workoutsThisWeek >= 4 ? `${name}, ${workoutsThisWeek} sessions this week. That is consistency. Now push the intensity.` : `${name}. ${workoutsThisWeek} sessions. More days, more results. Simple math.`}`;
  }
};
