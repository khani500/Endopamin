import { askGemini } from '../lib/gemini';
import { getCoach } from '../config/coaches';

function firstName(name) {
  return String(name || 'Champion').trim().split(/\s+/)[0] || 'Champion';
}

export const getDailyMessage = async (coachId, userContext) => {
  const coach = getCoach(coachId);
  const { name, streak, level, lastWorkout, goal, energy, gender } = userContext;
  const userName = firstName(name);

  const prompt = `
    Generate a personalized daily motivation message for ${userName}.
    Context:
    - Current streak: ${streak} days
    - Dopa Level: ${level}
    - Last workout: ${lastWorkout || 'yesterday'}
    - Fitness goal: ${goal}
    - Today's energy (1-5): ${energy || 'unknown'}
    - User gender identity: ${gender || 'not specified'}

    Make it feel personal and reference their actual stats.
    Do NOT start with "Hey" every time - vary the opening.
  `;

  return askGemini(prompt, coach.personality);
};

export const getCheckInResponse = async (coachId, userName, energy, sleep) => {
  const coach = getCoach(coachId);

  const prompt = `
    User ${firstName(userName)} just checked in.
    Energy level: ${energy}/5
    Sleep quality: ${sleep ? 'good' : 'poor'}

    Give them a personalized response and workout recommendation.
    If energy is 1-2: suggest rest/mobility
    If energy is 3: suggest moderate workout
    If energy is 4-5: push for performance
  `;

  return askGemini(prompt, coach.personality);
};

export const getProgressInsight = async (coachId, userName, metrics) => {
  const coach = getCoach(coachId);
  const { weightChange, workoutsThisWeek, topExercise, streak } = metrics;

  const prompt = `
    Analyze ${firstName(userName)}'s progress and give an insight:
    - Weight change: ${weightChange}kg this week
    - Workouts completed: ${workoutsThisWeek}/7 days
    - Best exercise progress: ${topExercise}
    - Current streak: ${streak} days

    Give one specific insight and one actionable tip.
  `;

  return askGemini(prompt, coach.personality);
};

export const generateWorkoutPlan = async (coachId, userProfile) => {
  const coach = getCoach(coachId);
  const { name, goal, experience, daysPerWeek, timeAvailable, injuries } = userProfile;

  const prompt = `
    Create a ${daysPerWeek}-day workout plan for ${firstName(name)}.
    Goal: ${goal}
    Experience: ${experience}
    Time per session: ${timeAvailable}
    Injuries/restrictions: ${injuries || 'none'}

    Return as JSON with this structure:
    {
      "plan": [
        {
          "day": "Monday",
          "type": "Strength",
          "duration": 45,
          "exercises": [
            { "name": "Bench Press", "sets": 3, "reps": 8, "rest": 90 }
          ]
        }
      ]
    }
    Return ONLY the JSON, no other text.
  `;

  const response = await askGemini(prompt, coach.personality);
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
};

export const chatWithCoach = async (coachId, userName, message, conversationHistory = [], gender) => {
  const coach = getCoach(coachId);
  const name = firstName(userName);

  const historyText = conversationHistory
    .slice(-6)
    .map(m => `${m.role === 'user' ? name : coach.name}: ${m.content}`)
    .join('\n');

  const prompt = `
    Previous conversation:
    ${historyText}

    ${name}: ${message}

    Respond as ${coach.name}.
    User gender identity: ${gender || 'not specified'}.
  `;

  return askGemini(prompt, coach.personality);
};

