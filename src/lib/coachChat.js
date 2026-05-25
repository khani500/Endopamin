const TRANSCRIPT_ARTIFACTS = [
  /\btalk here\b/gi,
  /\btap to speak\b/gi,
  /\btap here\b/gi,
  /\bclick here\b/gi,
  /\bmicrophone\b/gi,
];

const RESPONSE_ARTIFACTS = [
  /\btalk here\b/gi,
  /\btap to speak\b/gi,
  /^(hi!?|hello!?|hey!?)\s*(i'm|i am)\s+\w+,?\s*/gim,
];

/** Strip common STT / UI bleed-through from voice input. */
export function sanitizeTranscript(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  TRANSCRIPT_ARTIFACTS.forEach(pattern => {
    text = text.replace(pattern, '');
  });

  // Drop trailing non-English fragments often hallucinated at end of STT
  text = text.replace(/[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]+$/g, '').trim();
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text.length >= 2 ? text : '';
}

/** Clean model output: one persona, no UI artifacts. */
export function sanitizeCoachResponse(raw, coachName) {
  let text = String(raw || '').trim();
  if (!text) return '';

  RESPONSE_ARTIFACTS.forEach(pattern => {
    text = text.replace(pattern, '');
  });

  // If multiple coach names appear, keep from first paragraph only
  const otherCoaches = ['Aria', 'Kane', 'Blaze', 'Nova', 'Zara'].filter(
    n => n.toLowerCase() !== coachName.toLowerCase(),
  );
  const personaCount = otherCoaches.filter(n => new RegExp(`\\b${n}\\b`, 'i').test(text)).length;
  if (personaCount >= 1) {
    text = text.split(/\n{2,}/)[0]?.trim() || text;
  }

  return text.replace(/\s{2,}/g, ' ').trim();
}

export function buildProfileContext(profile, workoutTime, location, equipment) {
  const profileEquipment = Array.isArray(profile?.equipment)
    ? profile.equipment.join(', ')
    : profile?.equipment;

  const healthConditions = Array.isArray(profile?.health_conditions)
    ? profile.health_conditions.join(', ')
    : profile?.health_conditions;

  const weightLabel = profile?.weight
    ? `${profile.weight}${profile?.weight_unit ? ` ${profile.weight_unit}` : ' kg'}`
    : 'not specified';

  const heightLabel = profile?.height
    ? `${profile.height}${profile?.height_unit ? ` ${profile.height_unit}` : ' cm'}`
    : 'not specified';

  const targetWeightLabel = profile?.target_weight
    ? `${profile.target_weight}${profile?.weight_unit ? ` ${profile.weight_unit}` : ' kg'}`
    : 'not specified';

  return [
    `Name: ${profile?.display_name || 'Athlete'}`,
    `Age: ${profile?.age ?? 'not specified'}`,
    `Gender: ${profile?.gender ?? 'not specified'}`,
    `Goal: ${profile?.goal || 'fitness'}`,
    `Experience: ${profile?.experience || 'intermediate'}`,
    `Training location (profile): ${profile?.location || location || 'not specified'}`,
    `Daily activity level: ${profile?.activity || 'not specified'}`,
    `Diet / restrictions: ${profile?.diet || 'none'}`,
    `Injuries / restrictions (profile): ${profile?.injuries || 'none reported'}`,
    healthConditions ? `Health conditions: ${healthConditions}` : null,
    `Last workout (profile): ${profile?.last_workout || 'not specified'}`,
    `Target weight: ${targetWeightLabel}`,
    `Current weight: ${weightLabel}`,
    `Height: ${heightLabel}`,
    `Level: ${profile?.dopa_level || 1}`,
    `XP: ${profile?.dopa_xp || 0}`,
    `Session duration (profile): ${profile?.session_duration || workoutTime} min`,
    `Workout duration (session): ${workoutTime} min`,
    `Environment/Location (session): ${location}`,
    location === 'gym'
      ? `Session equipment: ${equipment.join(', ')}`
      : location === 'home'
        ? 'Session equipment: bodyweight / home-friendly (adapt to profile)'
        : 'Session equipment: desk / office (mobility & micro-breaks)',
    profileEquipment ? `Profile equipment: ${profileEquipment}` : null,
  ].filter(Boolean).join('\n');
}

/** Shared proactive coaching rules — applied to every coach persona. */
export const PROACTIVE_COACH_CRITICAL_INSTRUCTIONS = `CRITICAL INSTRUCTIONS — PRE-WORKOUT FLOW (MANDATORY BEFORE ANY WORKOUT):
Every session must follow this order. Never skip steps. Never dump a workout first and clarify later.

1. BEFORE THE WORKOUT — CHECK IN FIRST:
   - Read the ATHLETE CONTEXT below (profile database) BEFORE responding.
   - Review recent conversation history for prior workouts, goals, and stated preferences.
   - Ask about TODAY'S energy, sleep quality, and any injuries or pain — unless the user already answered in their latest message.
   - Do NOT generate, list, or prescribe exercises until profile data has been acknowledged AND today's status is clear.

2. NO SURPRISES — USE THE DATABASE UPFRONT:
   - You already know their goal, experience, injuries, equipment, location, diet, health conditions, and session duration from ATHLETE CONTEXT.
   - Cite relevant profile facts explicitly (e.g. known injuries, equipment limits, goal, experience) before prescribing.
   - Discuss limitations, contraindications, and preferences with the user first — adapt the plan to profile + today's check-in.
   - Never prescribe a workout that ignores known profile injuries or equipment, then apologize afterward.

3. LOGICAL FLOW — ALWAYS IN THIS ORDER:
   a) Brief greet (only if needed — the app greeting may already exist)
   b) Analyze & summarize what you know from profile + recent history
   c) Ask for or confirm current status (energy, sleep, injuries/pain today)
   d) Discuss adjustments or limitations if needed
   e) ONLY THEN provide the customized workout with warm-up + main work (sets, reps, RPE)

4. ONGOING COACHING (after check-in is complete):
   - Be proactive: adapt to home vs gym, fatigue, and equipment without being asked.
   - Maintain a structured plan; every workout prescription includes specific sets, reps, and RPE.
   - Always respond in English — adapt energy and tone to your persona, never sacrifice clarity or safety.

Example — WRONG: User says "I'm ready" → you immediately list squats and bench without checking energy, sleep, or profile injuries.
Example — RIGHT: User says "I'm ready" → you cite their profile goal/injuries/equipment, ask energy (1-10) + sleep + any pain today, then prescribe once answered.`;

export function getConversationPhase(messages) {
  const userTurns = messages.filter(m => m.role === 'user').length;
  if (userTurns === 0) return 'awaiting_checkin';
  if (userTurns === 1) return 'pre_workout_assessment';
  return 'coaching';
}

export function buildCoachSystemPrompt(basePrompt, coach, messages, profileContext) {
  const phase = getConversationPhase(messages);

  const phaseRules = {
    awaiting_checkin: `SESSION PHASE: Awaiting check-in reply
- Your greeting already asked about energy, sleep, and injuries/status. Wait for the user's answer.
- Do NOT prescribe any workout, exercise list, or training plan in this turn.
- Do NOT repeat the full greeting or re-ask the same check-in questions.`,
    pre_workout_assessment: `SESSION PHASE: Pre-workout assessment (NO WORKOUT YET unless check-in is complete)
- The user just replied to your greeting. Follow the mandatory pre-workout flow:
  1. Cite specific facts from ATHLETE CONTEXT (goal, experience, known injuries, equipment, location, diet, session duration).
  2. Summarize what the user said about TODAY's energy, sleep, and any pain/injuries.
  3. Discuss limitations, contraindications, or adjustments based on profile + today's status.
- If the user gave vague replies ("I'm ready", "let's go", "yes") WITHOUT energy/sleep/injury details:
  → Ask targeted follow-ups only. Do NOT prescribe exercises yet.
- If the user clearly provided energy, sleep, AND injury/status info AND you have reviewed ATHLETE CONTEXT:
  → You may prescribe today's full session (warm-up + main work with sets, reps, RPE) in this turn.
- Never surprise the user with a workout that ignores profile injuries or equipment.`,
    coaching: `SESSION PHASE: Active coaching (pre-workout check-in complete)
- Check-in and profile review are done for this session. Do NOT re-ask the full energy/sleep/injury questionnaire unless starting a brand-new workout block on a later day.
- Be proactive: use profile data and conversation history to prescribe the next logical workout or adjustment.
- Every workout prescription must include specific sets, reps, and RPE.
- If the user requests a new workout without sharing today's status, run a quick energy/sleep/injury check before prescribing.`,
  }[phase];

  return `${basePrompt}

${PROACTIVE_COACH_CRITICAL_INSTRUCTIONS}

ATHLETE CONTEXT:
${profileContext}

${phaseRules}

STRICT OUTPUT RULES:
- Respond ONLY as ${coach.name}. Never mention or speak as other coaches.
- ALWAYS reply in English only — even if the user writes or speaks Turkish or any other language. Never switch languages.
- MEMORY: You have the full conversation history above. Reference prior messages, prior workouts you prescribed, and the athlete's stated goals, injuries, and preferences. Never contradict yourself or forget what was already agreed in this session.
- PRE-WORKOUT GATE: Do not output a workout plan until profile data has been acknowledged and today's energy, sleep, and injury/status are confirmed (or clearly provided by the user).
- COMPLETENESS: Every reply must be a single, complete, non-fragmented answer. Never stop mid-plan, mid-sentence, or mid-exercise list. Finish the full prescription before ending.
- One single cohesive reply — no stacked greetings, no multi-persona scripts.
- Maximum 4 sentences for quick check-ins and profile/status discussions only; when prescribing a workout, give the full structured plan with sets, reps, and RPE (may exceed 4 sentences).
- Never output UI placeholders ("Talk here", "Tap to speak", etc.).
- Directly address the user's most recent message first, then advance their program logically through the pre-workout flow.`;
}

/** Convert app messages to Gemini multi-turn contents (role: user | model). */
export function toGeminiContents(messages) {
  const contents = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const text = String(msg.text || '').trim();
    if (!text) continue;

    if (contents.length === 0 && role === 'model') {
      contents.push({ role: 'user', parts: [{ text: '[Session started]' }] });
    }

    const last = contents[contents.length - 1];
    if (last?.role === role) {
      last.parts[0].text += `\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  if (contents[contents.length - 1].role === 'model') {
    contents.push({ role: 'user', parts: [{ text: 'Please continue.' }] });
  }

  return contents;
}
