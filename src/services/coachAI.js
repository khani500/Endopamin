import { askGemini, askGeminiChat, buildKnowledgeContext } from '../lib/gemini';
import { supabase } from '../lib/supabase';
import {
  buildCoachSystemPrompt,
  buildProfileContext,
  sanitizeCoachResponse,
  toGeminiContents,
} from '../lib/coachChat';
import { buildCoachReferenceContextAsync } from '../lib/coachContext';
import { buildCoachMemory, fetchCoachMemory, upsertCoachMemory } from '../lib/coachMemory';
import { formatCoachMemoryForPrompt } from '../config/coachPrompts';
import { getCoach, resolveCoachId } from '../config/coaches';

function firstName(name) {
  return String(name || 'Champion').trim().split(/\s+/)[0] || 'Champion';
}

function profileSessionContext(profile = {}) {
  const workoutTime = Number(profile?.session_duration || profile?.time_available) || 45;
  const location = profile?.location || 'gym';
  const equipment = Array.isArray(profile?.equipment) ? profile.equipment : [];
  return { workoutTime, location, equipment };
}

/** Core chat instructions — merged into buildCoachSystemPrompt via chatWithCoach. */
export const COACH_CHAT_INSTRUCTIONS = `ENDOPAMIN AI — HOW TO REPLY:

IDENTITY: You are an elite personal trainer who genuinely knows this athlete. You have access to their health data, workout history, and profile. Use this data naturally — like a coach who's been tracking them for weeks.

LANGUAGE: Respond ONLY in fluent, natural English. Sound human, warm, and real.

USE HEALTH DATA NATURALLY:
- If sleep was under 6 hours: acknowledge it and adjust today's intensity down. Example: "You only got 5 hours last night — let's keep today moderate."
- If steps are high (8000+): acknowledge their activity. Example: "You've already put in 9,000 steps today — solid."
- If active calories are high: recognize the effort. Example: "You've burned 400 calories already today — your body's working hard."
- If resting HR is elevated vs normal: suggest easier session or more warm-up time.
- If live HR is high during workout: tell them to back off or rest. Example: "Heart rate's spiking — take 90 seconds."
- Reference these naturally in conversation, not as a data report.

PERSONALITY & TONE:
- Sound like a real coach who genuinely cares — not a robot reading data.
- Use humor, banter, and encouragement naturally. Example: "Okay, 5 hours of sleep and you still showed up? Respect. Let's not kill you though."
- Celebrate wins, no matter how small. Example: "9,000 steps before noon? That's not nothing."
- Be direct and honest — if they're slacking, say it with humor. Example: "Three rest days in a row? Your muscles are basically begging you to train."
- Match energy — if they're pumped, match it. If they're tired, be gentler.

ONBOARDING IS DONE:
- ATHLETE PROFILE is confirmed. Do NOT re-ask sleep, energy, goals, injuries, equipment, or location.
- Only address pain or medical issues if the user raises them.

SESSION STRUCTURE (MANDATORY):
- Every workout prescription: Warm-up (5-10 min) → Main work (sets, reps, rest, RPE) → Cool-down (5 min).
- Progressive overload with safety — match difficulty to experience level.
- State session context when relevant: "This is your push day — chest and shoulders today."

REST DAY OVERRIDE:
- If the user refuses rest and wants to train: give them a full session. Never force rest on someone who wants to work.

PERIODIZATION:
- Program in 5-6 week blocks. Reference their history and progress when relevant.
- Adjust intensity based on recovery signals (sleep, HR, reported fatigue).

EXPERT MODE:
- When asked about form, anatomy, or programming: answer with precise professional detail.
- Name muscles, joint actions, common faults, and safe regressions or progressions.

CRITICAL — NO ROBOTIC OPENERS:
- Never start with "Understand", "Got it", "Certainly", "Of course", or "I understand".
- Jump straight into coaching. Start with the athlete, not yourself.`;

function shouldTriggerAssessment(profile = {}) {
  const { created_at } = profile;
  if (!created_at) return false;
  const daysSince = Math.floor((Date.now() - new Date(created_at)) / (1000 * 60 * 60 * 24));
  return daysSince > 0 && daysSince % 30 === 0;
}

export const getDailyMessage = async (coachId, userContext) => {
  const coach = getCoach(coachId);
  const resolvedId = resolveCoachId(coachId);
  const { name, streak, level, goal, energy, gender } = userContext;
  const userName = firstName(name);

  const mergedProfile = {
    display_name: userName,
    streak_count: streak,
    dopa_level: level,
    goal,
    energy_level: energy,
    gender,
    ...userContext,
  };
  const { workoutTime, location, equipment } = profileSessionContext(mergedProfile);
  const profileContext = buildProfileContext(mergedProfile, workoutTime, location, equipment);

  const prompt = `
Generate a personalized daily motivation message for ${userName}.

${profileContext}

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
      aria: `${userName}, ${streak} days of data logged. Stay consistent — your next session builds on today.`,
      kane: `${userName}. ${streak} days. Do not stop now.`,
      blaze: `${userName}! ${streak} days strong — let's make today count!`,
      nova: `${userName}, ${streak} consecutive days of adaptation. Your body is changing. Continue.`,
      zara: `${userName}, ${streak} days in. Your future self is already bragging about you.`,
    };
    return fallbacks[resolvedId] || fallbacks.aria;
  }
};

export const chatWithCoach = async (
  coachId,
  userName,
  message,
  conversationHistory = [],
  profile = {},
  userId = null,
) => {
  const coach = getCoach(coachId);
  const resolvedId = resolveCoachId(coachId);
  const name = firstName(userName);
  const { workoutTime, location, equipment } = profileSessionContext(profile);
  const profileContext = buildProfileContext(profile, workoutTime, location, equipment);
  const uid = userId || profile?.user_id || null;

  // Fetch active workout plan
  let weeklyPlanContext = '';
  if (uid) {
    try {
      const { data: activePlan } = await supabase
        .from('workout_plans')
        .select('plan_data, week_start')
        .eq('user_id', uid)
        .eq('coach_id', resolvedId)
        .eq('is_active', true)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      if (activePlan?.plan_data?.days) {
        const todayDate = new Date().toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
        const today = todayDate.split(',')[0].trim();
        const todayPlan = activePlan.plan_data.days.find(d => d.day === today);
        const planSummary = activePlan.plan_data.days
          .map(d => `${d.day}: ${d.focus} (${d.type === 'rest' ? 'REST' : d.exercises?.map(e => e.name).join(', ')})`)
          .join('\n');

        weeklyPlanContext = `\n--- USER'S ACTIVE WEEKLY PLAN ---\nToday's date: ${todayDate}\nWeek of: ${activePlan.week_start}\n${planSummary}\n${todayPlan ? `\nTODAY (${today}): ${todayPlan.focus}\nExercises: ${todayPlan.exercises?.map(e => `${e.name} ${e.sets}x${e.reps}`).join(', ')}` : `\nToday (${today}): Rest day`}\nUse this plan when giving advice. Reference today's workout specifically.\n--- END PLAN ---`;
      }
    } catch (_) {}
  }

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

  const knowledgeContext = await buildKnowledgeContext(profile?.experience);

  const storedMemory = uid ? await fetchCoachMemory(uid, resolvedId) : null;
  const liveMemory = buildCoachMemory(storedMemory, profile, workoutTime, equipment, historyMessages);
  const coachMemoryBlock = formatCoachMemoryForPrompt(liveMemory);

  const referenceContext = await buildCoachReferenceContextAsync({
    location,
    experience: profile?.experience,
    equipment,
    injuries: profile?.injuries,
    goal: profile?.goal,
    userMessage: message,
  });

  const basePrompt = `${coach.personality}

${coachMemoryBlock}

${weeklyPlanContext}

${assessmentNote}

${COACH_CHAT_INSTRUCTIONS}`;

  const systemPrompt = buildCoachSystemPrompt(
    basePrompt,
    { name: coach.name, id: coach.id },
    historyMessages,
    profileContext,
    {
      preservePersona: resolvedId === 'kane',
      profile,
      knowledgeContext,
      referenceContext,
    },
  );

  try {
    const raw = await askGeminiChat({
      messages: toGeminiContents(historyMessages),
      systemPrompt,
    });
    const reply = sanitizeCoachResponse(raw, coach.name);
    if (reply && uid) {
      const updatedMemory = buildCoachMemory(
        liveMemory,
        profile,
        workoutTime,
        equipment,
        [...historyMessages, { role: 'assistant', text: reply }],
      );
      void upsertCoachMemory(uid, resolvedId, updatedMemory);
    }
    return reply;
  } catch (error) {
    console.error('Coach chat failed:', error);
    const fallbacks = {
      aria: `${coach.name}: Connection dropped. Review your session plan and resume when ready.`,
      kane: `${coach.name}: Connection dropped. Here is your move ${name}: warm up now, first working set in 5 minutes. No waiting.`,
      blaze: `${coach.name}: Temporary glitch ${name}! Do not let it stop you — start with what you know!`,
      nova: `${coach.name}: Technical interruption, ${name}. While we reconnect — focus on your breathing and prime your nervous system.`,
      zara: `${coach.name}: The AI gods are testing us ${name}. Classic villain move. Just start moving anyway.`,
    };
    return fallbacks[resolvedId] || fallbacks.aria;
  }
};

export const getCheckInResponse = async (coachId, userName, energy, sleep, profile = {}) => {
  const coach = getCoach(coachId);
  const name = firstName(userName);
  const { workoutTime, location, equipment } = profileSessionContext(profile);
  const profileContext = buildProfileContext(profile, workoutTime, location, equipment);

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
  const { workoutTime, location, equipment } = profileSessionContext(profile);
  const profileContext = buildProfileContext(profile, workoutTime, location, equipment);

  const { weightChange, workoutsThisWeek, topExercise, streak, daysSinceStart } = metrics;

  const prompt = `
${profileContext}

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
