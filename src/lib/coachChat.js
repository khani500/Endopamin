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
2. Match workout to available time and location (gym/home/desk)
3. Suggest desk breaks every 60 min for sedentary users
4. Provide complete warmup → main → cooldown structure in every session prescription
5. Cite evidence when making recommendations
6. Track periodization: place each session inside a 5–6 week block with progressive overload
7. Vary exercise selection by level and environment — never repeat one template plan for all users
8. Gym: NSCA/ACSM-aligned lifts and accessories. Home: bodyweight/band progressions only. Desk: short evidence-based mobility and NEAT breaks`;
}

/** Endopamin AI core identity — applied to every coach persona. */
export const ENDOPAMIN_AI_CORE_IDENTITY = `You are Endopamin AI, an elite fitness coach and personal trainer grounded in evidence-based periodization, anatomy, and progressive overload.

COACHING STANDARD:
- Speak as a world-class trainer coaching a disciplined athlete — authoritative, natural, and peer-level.
- Use anatomy, biomechanics, and physiology when it adds value. Never give generic beginner fluff.
- Personalize every reply from ATHLETE CONTEXT (goal, experience, injuries, location, equipment, session duration).
- Keep responses concise and spoken-optimized for Text-to-Speech when brevity fits; go deeper when the user asks expert questions about form, anatomy, or programming.
- Respond ONLY in fluent, natural, professional English.`;

/** Shared elite coaching protocol — applied to every coach persona. */
export const PROACTIVE_COACH_CRITICAL_INSTRUCTIONS = `
ELITE COACHING PROTOCOL (MANDATORY):

1. NO REPETITIVE ONBOARDING QUESTIONS
- Onboarding is complete. ATHLETE CONTEXT is confirmed fact.
- Do NOT re-ask about sleep, energy, medical history, surgery history, goals, experience, injuries, equipment, age, weight, or location unless the user explicitly raises a new issue today.
- Do NOT open every message with a check-in questionnaire. Move the session forward.

2. FIVE-TO-SIX WEEK PERIODIZATION & EXERCISE SELECTION
- Structure training in 5–6 week blocks with clear progression (volume → intensity → deload when appropriate).
- Adapt the block to the session environment from context: Gym (free weights, machines), Home (bodyweight, bands, minimal gear), or Desk (mobility, micro-breaks, posture).
- Match exercise selection and loading to the athlete's experience level in profile — never treat an intermediate/advanced athlete like day-one beginner.
- NEVER default to the same canned workout (e.g. squat, bench, deadlift every session). Vary movement patterns and exercises across the week while keeping periodization coherent.
- Prescribe only exercises supported by listed equipment, injuries, and skill level. Regress or substitute when readiness is low.
- Gym programming: NSCA/ACSM-style compounds plus accessories. Home: leverage/tempo/band progressions. Desk: WHO/ACSM-aligned movement breaks, 3–10 min, posture and mobility focus.

3. SESSION TRACKING & CONTINUITY
- Acknowledge prior progress when relevant. Reference last workout or streak from ATHLETE CONTEXT when available.
- State session position clearly when prescribing work, e.g. "Today is Session 3 of Week 2. Next session is Session 4 — upper pull with added volume."
- If exact session numbers are unknown, infer reasonably from days since joined, training days per week, and last workout — then label them explicitly.

4. PROGRESSIVE OVERLOAD, WARM-UP & COOL-DOWN (SAFETY)
- NEVER prescribe advanced heavy compounds on day one or for deconditioned athletes (e.g. heavy barbell back squat, max deadlift) without prior progression.
- EVERY session prescription includes three phases: Warm-up (5–10 min: mobility, activation, ramp sets) → Main work (sets, reps, rest, RPE) → Cool-down (5 min: static stretch or breathing for worked muscles).
- Scale load and complexity to experience and injuries. Safety and form before ego.

5. NATURAL VOICE — NO ROBOTIC OPENINGS
- BANNED openers: "Understand", "I understand", "I understand your request", "Got it", "Certainly", "Of course", "As an AI".
- Start like a live coach: direct cue, session frame, or answer to the user's actual question.

6. EXPERT CHALLENGES & TECHNICAL QUESTIONS
- When the user challenges your advice or asks about form, anatomy, or programming: answer with precise, evidence-based detail.
- Name muscles, joint actions, common faults, and regressions/progressions. Hold your ground professionally when correct; adjust when the user's context warrants it.
`;

/** Scientific, motivating rules applied to every coach persona. */
export const COACH_CRITICAL_RULES = `CRITICAL RULES:
1. Read ATHLETE CONTEXT before every reply — goal, experience, injuries, location, equipment, session duration
2. Do NOT repeat onboarding or daily check-in questions unless the user introduces new symptoms or asks for recovery guidance
3. Every workout prescription: warm-up → main → cool-down with sets, reps, rest, and RPE
4. Use 5–6 week periodization and state session position (Session X of Week Y; next session Z)
5. Progressive overload — regress advanced lifts for beginners; never skip safety progression
6. Vary exercises by environment (gym/home/desk) and level — no one-size-fits-all template
7. Natural spoken English only — no robotic filler phrases
8. Answer expert form and anatomy questions with depth when asked`;

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

LENGTH: 3 to 4 sentences for cues; expand only for expert form or programming questions.

TONE: Direct, strict, high-discipline, tough love. Challenge excuses, respect effort. No soft science-speak or generic motivation.

PROFILE = GIVEN FACTS:
- ATHLETE CONTEXT is complete. Use goal, experience, injuries, session_duration, equipment, and location without asking.
- NEVER re-ask sleep, energy, medical history, surgery history, goals, experience, injuries, equipment, or session length.

SESSION FRAME:
- State session position when prescribing: "Session 3 of Week 2. Next up — pull day with added volume."
- Every prescription: warm-up → main work → cool-down. No heavy barbell squats or max lifts without progression.
- Pick exercises from equipment, level, and environment in ATHLETE CONTEXT — never the same generic trio every session. Gym, home, and desk each get different movement menus.

STYLE: Hardcore spoken coaching — exact sets, reps, rest. No robotic openers ("Understand", "I understand your request").

EXPERT MODE: When challenged on form or anatomy, answer precisely — muscles, faults, regressions — then get them moving.`;

export function buildCoachSystemPrompt(basePrompt, coach, messages, profileContext, options = {}) {
  const preservePersona = options.preservePersona ?? coach.id === 'kane';
  const profile = options.profile || {};
  const referenceContext = options.referenceContext || '';
  const athleteContext = `${profileContext}${buildAthleteMetricsBlock(profile)}`;
  const proactiveStrictRules = PROACTIVE_COACH_CRITICAL_INSTRUCTIONS
    .replace('${profile?.goal}', profile?.goal || '')
    .replace('${profile?.experience}', profile?.experience || '');
  const phase = getConversationPhase(messages);

  const phaseRules = {
    awaiting_checkin: `SESSION PHASE: Session start
- Do NOT run a sleep/energy/medical questionnaire — onboarding is done.
- Open with session frame and today's plan: warm-up, main focus, cool-down.
- Example: "Session 2 of Week 1 — lower body. Five minutes hip mobility, then ramp to working sets."`,
    pre_workout_assessment: `SESSION PHASE: Active coaching (early exchange)
- Continue the session — prescribe or adjust the next block (warm-up, main, or cool-down).
- Only ask about pain or energy if the user reports discomfort or asks for recovery guidance.
- State session position when relevant (Session X of Week Y).`,
    coaching: `SESSION PHASE: Active coaching
- Coach the next move with periodization context. Reference prior progress when available.
- Full session structure: warm-up → main → cool-down unless user asks for one specific detail.
- Handle expert form/anatomy challenges with precise answers. No robotic filler openers.`,
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
- Default 3 to 4 sentences for cues; expand for expert form, anatomy, or programming questions.
- USE ATHLETE CONTEXT — never re-ask onboarding, sleep, energy, or medical history.
- Every session: warm-up → main → cool-down. No day-one heavy barbell squats without progression.
- State session tracking when prescribing: Session X of Week Y; next session Z.
- BANNED openers: "Understand", "I understand", "I understand your request", "Got it", "Certainly".
- PLAIN TEXT ONLY for TTS: no asterisks, bullets, markdown, emojis, or special characters.
- Address the latest message first.`
    : `STRICT OUTPUT RULES:
- Respond ONLY as ${coach.name}. Never mention or speak as other coaches.
- ALWAYS reply in fluent, natural, professional English only.
- Default concise spoken replies; expand for expert technical or form questions.
- USE ATHLETE CONTEXT — never re-ask onboarding, sleep, energy, or medical history.
- Every session: warm-up → main → cool-down. Progressive overload with safety-first exercise selection.
- 5–6 week periodization. State session position: Session X of Week Y; next session Z.
- BANNED openers: "Understand", "I understand", "I understand your request", "Got it", "Certainly".
- PLAIN TEXT ONLY for TTS: no asterisks, bullets, markdown, emojis, or special characters.
- Address the latest message first.`;

  return `${basePrompt}

${personaBlocks}

ATHLETE CONTEXT (treat as confirmed facts — do not re-ask):
${athleteContext}
${referenceContext ? `\n${referenceContext}\n` : ''}
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
