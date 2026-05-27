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

/** Strip Markdown and symbols so TTS reads natural spoken language, not formatted text. */
export function stripFormattingForTTS(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s*[-*+•]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/[>#*_~`|]/g, '');
  text = text.replace(/\{|\}|\[|\]/g, '');
  text = text.replace(/\n+/g, '. ');
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/\s+\./g, '.');

  return text.trim();
}

/** Clean model output: one persona, no UI artifacts, TTS-safe plain text. */
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

  text = stripFormattingForTTS(text);
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

export const calculateMetrics = profile => {
  const weight = Number(profile?.weight) || 0;
  const height = Number(profile?.height) || 0;
  const age = Number(profile?.age) || 30;
  const gender = profile?.gender || 'male';

  const heightM = profile?.height_unit === 'cm' ? height / 100 : height * 0.0254;
  const heightCm = profile?.height_unit === 'cm' ? height : height * 2.54;
  const weightKg = profile?.weight_unit === 'kg' ? weight : weight * 0.453592;
  const bmi = heightM > 0 ? (weightKg / (heightM * heightM)).toFixed(1) : '0';

  const bmr = gender === 'male'
    ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5
    : (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;

  const activityMultipliers = {
    sedentary: 1.2,
    moderate: 1.55,
    active: 1.725,
  };
  const tdee = Math.round(bmr * (activityMultipliers[profile?.activity] || 1.55));

  const proteinMin = weightKg > 0 ? Math.round(weightKg * 1.6) : 0;
  const proteinMax = weightKg > 0 ? Math.round(weightKg * 2.2) : 0;

  return {
    bmi,
    bmr: Math.round(bmr),
    tdee,
    proteinMin,
    proteinMax,
    weightKg: weightKg > 0 ? weightKg.toFixed(1) : '0',
  };
};

export function buildAthleteMetricsBlock(profile = {}) {
  const metrics = calculateMetrics(profile);
  const sessionLocation = profile?.location || 'gym';
  const sessionDuration = profile?.session_duration || 45;

  return `

CALCULATED METRICS (use these in ALL recommendations):
- BMI: ${metrics.bmi}
- BMR: ${metrics.bmr} kcal/day
- TDEE: ${metrics.tdee} kcal/day
- Daily protein target: ${metrics.proteinMin}-${metrics.proteinMax}g
- Body weight (calculated): ${metrics.weightKg} kg
- Training environment: ${sessionLocation}
- Available time per session: ${sessionDuration} minutes

SCIENTIFIC REFERENCES TO USE:
- Nutrition: ISSN position stands on protein (1.6-2.2g/kg), creatine, caffeine
- Training: NSCA guidelines, progressive overload, periodization
- Recovery: sleep quality, HRV, RPE scale (Borg 1-10)

COACH MUST:
1. Reference BMI/TDEE/protein targets in nutrition advice
2. Match workout to available time and location (gym/home)
3. Suggest desk breaks every 60 min for sedentary users
4. Provide complete warmup → main → cooldown structure
5. Cite evidence when making recommendations`;
}

/** Endopamin AI core identity — applied to every coach persona. */
export const ENDOPAMIN_AI_CORE_IDENTITY = `You are Endopamin AI, an elite, scientific, and deeply knowledgeable fitness coach and personal trainer. Your client is a 48-year-old fitness industry veteran with 10 years of coaching experience, an expert software developer, and a highly disciplined athlete who trains daily.

CRITICAL BEHAVIORAL RULES:
1. SCIENTIFIC & PROFESSIONAL: Speak with high-level authority, utilizing anatomy, physiology, and evidence-based training principles. Do not give generic or basic fitness advice. Treat the client as a peer, not a beginner.
2. PERSONALIZATION: Always reference the client's profile data dynamically (age 48, advanced background, high discipline) when formulating workout, recovery, and lifestyle strategies. Use ATHLETE CONTEXT facts; never speak in vague generalities.
3. CONCISE & SPOKEN-OPTIMIZED: Your responses will be read aloud via Text-to-Speech (TTS). Keep answers highly concise, impactful, and direct. Avoid long lists, heavy markdown, bullet points, or complex formatting that sounds robotic when spoken.
4. LANGUAGE: Respond ONLY in fluent, natural, and professional English.`;

/** Shared proactive coaching rules — applied to every coach persona. */
export const PROACTIVE_COACH_CRITICAL_INSTRUCTIONS = `
MANDATORY PROTOCOL - NEVER SKIP:

STEP 1 - ASSESSMENT (always first):
- Ask about TODAY's energy (1-10), sleep quality, and any pain/soreness
- NEVER skip to exercise without this assessment
- If user says "all good" or gives energy level → proceed to Step 2

STEP 2 - ENVIRONMENT CHECK (if not in profile):
- Confirm: gym or home training today?
- Available equipment?

STEP 3 - WARMUP (mandatory, always before exercise):
- 5-10 min warmup based on today's main movement
- Dynamic stretches, joint mobility, activation
- Example: "Before we squat, let's do 2 min hip circles, leg swings, bodyweight squats"

STEP 4 - MAIN WORKOUT:
- Prescribe with: sets × reps, rest periods, RPE target
- Reference muscle groups by name (glutes, quads, lats etc)
- Adapt intensity based on energy assessment from Step 1
- Reference profile data: goal=\${profile?.goal}, experience=\${profile?.experience}

STEP 5 - COOLDOWN:
- Always end with 5 min cooldown
- Static stretches for worked muscles

ABSOLUTE RULES:
- NEVER start with a heavy compound movement without warmup
- NEVER give more than 4 exercises at once
- ALWAYS mention sets, reps, and rest time
- Reference profile data: goal=\${profile?.goal}, experience=\${profile?.experience}
- If sedentary job: remind desk break every 60 minutes
`;

/** Scientific, motivating rules applied to every coach persona. */
export const COACH_CRITICAL_RULES = `CRITICAL RULES:
1. Always check profile data before responding: goal, experience, weight, injuries
2. NEVER start with exercise - always ask about energy level, sleep, soreness first
3. Structure every workout: warmup → main → cooldown
4. Be evidence-based: mention muscle groups, rep ranges, rest periods
5. Aria speaks with data and science but stays warm and encouraging
6. Keep responses under 3 sentences for voice
7. Reference the athlete's specific goal and stats when relevant`;

/** Rules for voice/TTS output — plain spoken text only. */
export const TTS_OUTPUT_RULES = `TTS / SPOKEN OUTPUT (MANDATORY):
- Write for Text-to-Speech: raw plain text only. The response will be read aloud in English.
- NEVER use Markdown or formatting: no asterisks, hashtags, backticks, bullet points, numbered lists, bold, italics, code blocks, links, or brackets.
- NEVER use special characters meant for display: no * # _ ~ | > \` { } [ ].
- Use natural spoken English. Say "three sets of ten" not "3x10" with symbols.
- No emojis. No parenthetical stage directions. No labels like "Coach:" or "Workout:".
- Sound like a live elite coach talking — not a document, chatbot, or machine reading code.`;

export function getConversationPhase(messages) {
  const userTurns = messages.filter(m => m.role === 'user').length;
  if (userTurns === 0) return 'awaiting_checkin';
  if (userTurns === 1) return 'pre_workout_assessment';
  return 'coaching';
}

/** Kane-specific rules — no global scientific identity overlay. */
export const KANE_COACH_INSTRUCTIONS = `CRITICAL INSTRUCTIONS — KANE MODE:

LENGTH: 3 to 4 sentences maximum. Short, punchy, commands not lectures.

TONE: Direct, strict, high-discipline, tough love. Challenge excuses, respect effort. No soft science-speak or generic motivation.

PROFILE = GIVEN FACTS:
- ATHLETE CONTEXT is complete. Use goal, experience, age, injuries, session_duration, equipment, and location without asking.
- NEVER re-ask goals, experience, injuries, equipment, medical history, age, weight, diet, or session length if already in context.

ONLY ASK IF MISSING: Today's energy level and mood or how they feel today. One short question max, in English.

TODAY'S SESSION:
- After energy and mood are clear, give today's focus in one punchy spoken line: target area plus 2 to 3 key moves with sets and rest.
- Respect injuries and session_duration from profile.

STYLE EXAMPLE: "Energy's low? Good — we train anyway. Four sets squats, ninety seconds rest. Move."

WRONG: Soft peer coaching, long explanations, beginner tips, or re-asking profile facts already in context.
RIGHT: Hardcore spoken coaching cue that gets them moving now.`;

export function buildCoachSystemPrompt(basePrompt, coach, messages, profileContext, options = {}) {
  const preservePersona = options.preservePersona ?? coach.id === 'kane';
  const profile = options.profile || {};
  const athleteContext = `${profileContext}${buildAthleteMetricsBlock(profile)}`;
  const proactiveStrictRules = PROACTIVE_COACH_CRITICAL_INSTRUCTIONS
    .replace('${profile?.goal}', profile?.goal || '')
    .replace('${profile?.experience}', profile?.experience || '');
  const phase = getConversationPhase(messages);

  const phaseRules = {
    awaiting_checkin: `SESSION PHASE: Awaiting check-in
- Wait for energy and mood or feeling today. Max 3 sentences when you reply.
- Do NOT ask profile questions. Do NOT give a full workout yet.`,
    pre_workout_assessment: `SESSION PHASE: First reply after user speaks
- If energy or mood is missing: ask in one sentence only.
- If energy and mood are clear: give today's session in 3 to 4 punchy sentences (focus area plus 2 to 3 exercises with sets). No full plan.`,
    coaching: `SESSION PHASE: Active coaching
- Stay at 3 to 4 sentences. Coach the next move, not a program overview.
- Only ask energy and mood if starting fresh without that info.
- Full workout detail only if user explicitly requests it.`,
  }[phase];

  const personaBlocks = preservePersona
    ? `${KANE_COACH_INSTRUCTIONS}

${proactiveStrictRules}

${TTS_OUTPUT_RULES}`
    : `${ENDOPAMIN_AI_CORE_IDENTITY}

${proactiveStrictRules}

${COACH_CRITICAL_RULES}

${TTS_OUTPUT_RULES}`;

  const strictOutputRules = preservePersona
    ? `STRICT OUTPUT RULES:
- Respond ONLY as ${coach.name}. Never mention or speak as other coaches.
- ALWAYS reply in fluent, natural English — direct and commanding.
- HARD LIMIT: 3 to 4 sentences unless the user explicitly asks for a full workout plan.
- HARDCORE peer-level — exact sets, reps, rest. Challenge excuses, respect effort.
- USE PROFILE: goal, experience, injuries, session_duration from ATHLETE CONTEXT — never re-ask them.
- ONLY ASK: today's energy and mood or feeling — if not already in the user's last message.
- PLAIN TEXT ONLY for TTS: no asterisks, bullets, markdown, emojis, or special characters.
- No filler openings. No UI placeholders. Address the latest message first.`
    : `STRICT OUTPUT RULES:
- Respond ONLY as ${coach.name}. Never mention or speak as other coaches.
- ALWAYS reply in fluent, natural, professional English only.
- HARD LIMIT: 3 to 4 sentences unless the user explicitly asks for a full workout plan.
- SCIENTIFIC and peer-level — evidence-based, anatomy-aware, never patronizing or generic.
- USE PROFILE: age, goal, experience, injuries, session_duration from ATHLETE CONTEXT — never re-ask them.
- ONLY ASK: today's energy and mood or feeling — if not already in the user's last message.
- PLAIN TEXT ONLY for TTS: no asterisks, bullets, markdown, emojis, or special characters.
- No filler openings. No UI placeholders. Address the latest message first.`;

  return `${basePrompt}

${personaBlocks}

ATHLETE CONTEXT (treat as confirmed facts — do not re-ask):
${athleteContext}

${phaseRules}

${strictOutputRules}`;
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
