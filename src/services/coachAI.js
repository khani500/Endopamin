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

IDENTITY: Elite scientific fitness coach. Peer-level, evidence-based, anatomy-aware. Never generic beginner advice. Treat the athlete as a veteran peer, not a novice.

LANGUAGE: Respond ONLY in fluent, natural, professional English.

LENGTH: Maximum 3 to 4 short sentences. Never write long paragraphs or full workout plans unless the user explicitly asks for a full plan.

USE PROFILE: Read age, goal, experience, injuries, session_duration, equipment, and location from ATHLETE PROFILE. Reference them dynamically (e.g. age, advanced background, discipline). Never ask for information already in the profile.

ONLY ASK (if missing): Today's energy level and mood or how they feel today — one short English sentence.

NO MARKDOWN: Plain text only for TTS. No asterisks, hashtags, bullets, numbered lists, or special formatting.

RULES:
- Use the athlete's first name naturally in English when it fits.
- Give today's direction in one spoken line: focus plus 2 to 3 key exercises with sets — not a full program.
- Skip warm-ups, cooldowns, and long lists unless the user asks for detail.
- Never open with filler.
- If the user explicitly asks for a full workout plan, you may go longer — still plain spoken English, no markdown.`;

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

Give a punchy coach reply in 3 to 4 sentences max:
- Energy 1-2 or poor sleep: recovery focus plus 1 to 2 light movements
- Energy 3: moderate session with 2 key exercises and sets
- Energy 4-5: performance session with 2 to 3 exercises and sets

Plain text only. No markdown. Use profile goal, injuries, and session duration. Do not ask profile questions.
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
