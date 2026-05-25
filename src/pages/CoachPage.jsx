import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCoachSession } from '../context/CoachContext';
import { useVoiceSession } from '../hooks/useVoiceSession';
import { askGeminiChat, askGeminiChatStream } from '../lib/gemini';
import {
  coachAudioRef,
  playCoachAudio,
  speakStreamingText,
  stopCoachAudio,
  isSpeaking,
  isIOSDevice,
} from '../lib/voice';
import {
  buildCoachSystemPrompt,
  buildProfileContext,
  sanitizeCoachResponse,
  sanitizeTranscript,
  toGeminiContents,
} from '../lib/coachChat';
import { getExerciseData } from '../lib/exerciseDB';

const COACHES = [
  {
    id: 'aria', name: 'Aria', role: 'Science Coach', color: '#CCFF00',
    unlocked: true, tagline: 'Data-driven. Precise. Proven.',
    greeting: "Aria here. I'll build your program from the science — quick check-in first: how's your energy, sleep, and any soreness today?",
    systemPrompt: `You are Aria, the Serious/Analytical coach for the ENDOPAMIN app. Your goal is to guide the user dynamically without waiting for them to prompt every single step.

PERSONALITY ARCHETYPE: Serious / Analytical Coach
- Tone: Professional, calm, scientific, and highly educational.
- Style: Focus on form, biomechanics, physiology, precise numbers, and the exact science behind every exercise.
- Explain WHY each exercise is chosen (muscle activation, joint angles, recovery windows).
- Reference RPE, volume landmarks, and progressive overload with clinical clarity.
- Stay warm but never fluffy — you teach like a professor who also trains athletes.`,
  },
  {
    id: 'kane', name: 'Kane', role: 'Hardcore Trainer', color: '#FFA53C',
    unlocked: true, tagline: 'No excuses. Only results.',
    greeting: "Kane. Drop the excuses. Tell me your goal, injuries, and energy level — then we work.",
    systemPrompt: `You are Kane, the Tough / Harsh coach for the ENDOPAMIN app. Your goal is to guide the user dynamically without waiting for them to prompt every single step.

PERSONALITY ARCHETYPE: Sergeant / Hardcore Trainer
- Tone: Direct, strict, high-discipline, and no-nonsense.
- Style: Push the user to their absolute limits with tough love. Challenge them directly.
- Call out excuses without being cruel — you respect effort, not comfort.
- Short, punchy sentences. Commands, not suggestions. "Do the work."
- Still prescribe exact sets, reps, and RPE — discipline includes precision.`,
  },
  {
    id: 'blaze', name: 'Blaze', role: 'Hype Coach 🇺🇸', color: '#FF6B6B',
    unlocked: false, unlockReq: 'Level 5 — 3000 XP', unlockXp: 3000,
    tagline: 'No cap. All gains.',
    greeting: "YO!! Blaze here 🔥 Quick vibe check bestie — energy 1-10, any injuries, and are we slaying or what??",
    systemPrompt: `You are Blaze, the Humorous coach for the ENDOPAMIN app. Your goal is to guide the user dynamically without waiting for them to prompt every single step.

PERSONALITY ARCHETYPE: Humorous / Witty Coach
- Tone: Lighthearted, funny, witty, and entertaining.
- Style: Use fitness jokes, gym humor, and playful roasts that motivate — never mean-spirited.
- Diffuse workout pain with humor while delivering real, professional programming underneath the jokes.
- Gen-Z energy and slang are welcome; every joke still ends with actionable sets, reps, and RPE.
- Make training feel fun — the user should laugh AND know exactly what to do next.`,
  },
  {
    id: 'nova', name: 'Nova', role: 'Mindset Coach', color: '#A064FF',
    unlocked: false, unlockReq: '7-day streak',
    tagline: 'Your mind leads. Your body follows.',
    greeting: "Nova here. Before we move — how are you feeling mentally and physically today? Any stress, tension, or wins you want to celebrate?",
    systemPrompt: `You are Nova, the Motivational / Mindset coach for the ENDOPAMIN app. Your goal is to guide the user dynamically without waiting for them to prompt every single step.

PERSONALITY ARCHETYPE: Motivational / Empathetic Coach
- Tone: Empathetic, deeply encouraging, uplifting, and positive.
- Style: Focus on mindset, confidence, breath, and sustainable momentum — the calm cheerleader.
- Celebrate small wins loudly. Reframe setbacks as data, not failure.
- Connect movement to mental clarity, sleep, and daily energy.
- Prescribe full sessions with sets, reps or time, and RPE — encouragement always paired with structure.`,
  },
  {
    id: 'zara', name: 'Zara', role: 'Strength Coach', color: '#C084FC',
    unlocked: false, unlockReq: '10 workouts completed',
    tagline: 'Fierce. Warm. Unstoppable.',
    greeting: "Zara here! You're stronger than you think — tell me how you're feeling today and what you want to conquer.",
    systemPrompt: `You are Zara, the Motivational / Strength coach for the ENDOPAMIN app. Your goal is to guide the user dynamically without waiting for them to prompt every single step.

PERSONALITY ARCHETYPE: Motivational / High-Energy Cheerleader
- Tone: Fierce, warm, confident, and deeply supportive — the ultimate hype partner for strength training.
- Style: Build confidence through compound lifts, PRs, and progressive overload. Celebrate every rep.
- Be firm on form and safety; soft on the person. "You've got this" backed by exact loading prescriptions.
- Reference the user's prior sessions and progress when available — make them feel seen.
- Every plan includes specific sets, reps, and RPE with technique cues that empower, not intimidate.`,
  },
];

const GYM_EQUIPMENT = [
  { id: 'barbell', name: 'Barbell', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="11" width="4" height="2" rx="1"/><rect x="18" y="11" width="4" height="2" rx="1"/><rect x="5" y="9" width="3" height="6" rx="1"/><rect x="16" y="9" width="3" height="6" rx="1"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
  { id: 'dumbbell', name: 'Dumbbell', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="1" y="11" width="3" height="2" rx="0.5"/><rect x="20" y="11" width="3" height="2" rx="0.5"/><rect x="3" y="10" width="2" height="4" rx="0.5"/><rect x="19" y="10" width="2" height="4" rx="0.5"/><line x1="5" y1="12" x2="19" y2="12"/></svg> },
  { id: 'cables', name: 'Cable', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M4 4v16M20 4v16"/><path d="M4 8h16M4 16h16"/><circle cx="12" cy="12" r="2"/></svg> },
  { id: 'bench', name: 'Bench', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="9" width="20" height="4" rx="2"/><path d="M5 13v4M19 13v4"/><path d="M3 9V7a1 1 0 011-1h16a1 1 0 011 1v2"/></svg> },
  { id: 'squat_rack', name: 'Squat Rack', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="3" y="2" width="3" height="20" rx="1"/><rect x="18" y="2" width="3" height="20" rx="1"/><path d="M6 8h12M6 16h12"/><path d="M8 8v8M16 8v8"/></svg> },
  { id: 'pull_up', name: 'Pull-up Bar', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="2" y1="5" x2="22" y2="5"/><path d="M8 5v5a4 4 0 008 0V5"/><path d="M12 14v6"/></svg> },
  { id: 'treadmill', name: 'Treadmill', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M5 20h14"/><path d="M3 14l4-8 4 4 4-6 4 10"/><circle cx="18" cy="6" r="1"/></svg> },
  { id: 'kettlebell', name: 'Kettlebell', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M8 8a4 4 0 018 0"/><path d="M6 8c0 6 2 10 6 12s6-6 6-12"/><path d="M9 8h6"/></svg> },
  { id: 'smith', name: 'Smith Machine', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="2" width="3" height="20" rx="1"/><rect x="19" y="2" width="3" height="20" rx="1"/><path d="M5 12h14"/><rect x="7" y="10" width="10" height="4" rx="1"/></svg> },
  { id: 'resistance', name: 'Bands', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M5 12c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7-7-3.13-7-7z"/><path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4z"/></svg> },
  { id: 'leg_press', name: 'Leg Press', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M4 20l5-8 4 4 5-10"/><rect x="2" y="18" width="20" height="3" rx="1"/></svg> },
  { id: 'bodyweight', name: 'Bodyweight', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="12" cy="4" r="2"/><path d="M12 6v6M9 9l3-3 3 3"/><path d="M9 18l3 3 3-3M12 12v6"/><path d="M6 13c0 0 2-2 6-2s6 2 6 2"/></svg> },
];

const WORKOUTS = {
  gym: [
    { id:1, name:'Barbell Back Squat', muscle:'Quads · Glutes · Core', sets:'4×8', rest:'90s', diff:'hard', cal:45, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/></svg> },
    { id:2, name:'Flat Bench Press', muscle:'Chest · Triceps · Front Delt', sets:'4×10', rest:'90s', diff:'hard', cal:40, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="2" y="10" width="20" height="3" rx="1"/><path d="M6 10V7M18 10V7M8 7h8"/><path d="M5 13v4M19 13v4"/></svg> },
    { id:3, name:'Romanian Deadlift', muscle:'Hamstrings · Glutes · Back', sets:'3×8', rest:'120s', diff:'hard', cal:55, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 8h4M18 8h4"/><path d="M8 12h8"/><path d="M12 12v4"/></svg> },
    { id:4, name:'Weighted Pull-Ups', muscle:'Lats · Biceps · Rear Delt', sets:'4×8', rest:'90s', diff:'hard', cal:38, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="2" y1="4" x2="22" y2="4"/><path d="M8 4v5a4 4 0 008 0V4"/><path d="M12 13v7"/></svg> },
    { id:5, name:'Overhead Press', muscle:'Shoulders · Triceps · Core', sets:'4×10', rest:'75s', diff:'medium', cal:35, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M8 20V10M16 20V10"/><path d="M5 10h14"/><path d="M3 6h2M19 6h2M5 6h14"/></svg> },
    { id:6, name:'Cable Row', muscle:'Mid Back · Rhomboids · Biceps', sets:'4×12', rest:'60s', diff:'medium', cal:30, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 4v16"/><path d="M4 12h12"/><path d="M12 8l4 4-4 4"/><circle cx="20" cy="12" r="2"/></svg> },
    { id:7, name:'Hack Squat', muscle:'Quads · Glutes', sets:'4×12', rest:'90s', diff:'medium', cal:42, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 20l4-8 4 6 4-10 4 12"/><line x1="2" y1="20" x2="22" y2="20"/></svg> },
    { id:8, name:'Incline Dumbbell Press', muscle:'Upper Chest · Front Delt', sets:'3×12', rest:'75s', diff:'medium', cal:32, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 16l4-8 12 4"/><path d="M6 12l2-4M14 15l2-4"/></svg> },
    { id:9, name:'Lat Pulldown', muscle:'Lats · Biceps', sets:'4×12', rest:'60s', diff:'medium', cal:28, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="2" y1="4" x2="22" y2="4"/><path d="M6 4l6 10 6-10"/><path d="M12 14v6"/></svg> },
    { id:10, name:'Tricep Pushdown', muscle:'Triceps', sets:'3×15', rest:'45s', diff:'easy', cal:20, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M12 4v12"/><path d="M8 12l4 4 4-4"/><circle cx="12" cy="4" r="2"/></svg> },
    { id:11, name:'Face Pulls', muscle:'Rear Delts · Rotator Cuff', sets:'3×15', rest:'45s', diff:'easy', cal:18, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M22 12H10"/><path d="M14 8l-4 4 4 4"/><circle cx="6" cy="12" r="4"/></svg> },
    { id:12, name:'Calf Raises', muscle:'Calves · Soleus', sets:'4×20', rest:'30s', diff:'easy', cal:15, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M8 20V8a4 4 0 018 0v12"/><line x1="5" y1="20" x2="19" y2="20"/><path d="M10 8v4M14 8v4"/></svg> },
  ],
  home: [
    { id:1, name:'Diamond Push-Ups', muscle:'Chest · Triceps · Core', sets:'4×15', rest:'45s', diff:'hard', cal:30, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 14l4-8 4 12 4-8 4 4"/><line x1="2" y1="18" x2="22" y2="18"/></svg> },
    { id:2, name:'Jump Squats', muscle:'Quads · Glutes · Calves', sets:'4×20', rest:'60s', diff:'hard', cal:42, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="4" r="2"/><path d="M12 6v4M9 10l-3 6h12l-3-6M8 16l-2 5M16 16l2 5"/></svg> },
    { id:3, name:'Burpees', muscle:'Full Body · Cardio', sets:'4×12', rest:'60s', diff:'hard', cal:55, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M12 3v3M6 8l2 2M18 8l-2 2M4 14h16M8 18l-2 3M16 18l2 3M12 14v5"/></svg> },
    { id:4, name:'Pistol Squat', muscle:'Quads · Balance · Glutes', sets:'3×8 each', rest:'75s', diff:'hard', cal:38, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="4" r="2"/><path d="M12 6v5l-3 3M12 11l3 3M9 14l-3 6M15 14l1 6"/></svg> },
    { id:5, name:'Mountain Climbers', muscle:'Core · Shoulders · Cardio', sets:'4×40s', rest:'30s', diff:'hard', cal:45, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M3 20l5-10 4 6 4-8 5 12"/><line x1="2" y1="20" x2="22" y2="20"/></svg> },
    { id:6, name:'Pike Push-Ups', muscle:'Shoulders · Triceps', sets:'4×12', rest:'45s', diff:'medium', cal:28, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 18l6-12 4 8 4-4 2 8"/></svg> },
    { id:7, name:'Plank to Push-Up', muscle:'Core · Chest · Triceps', sets:'3×10', rest:'45s', diff:'medium', cal:25, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="2" y1="14" x2="22" y2="14"/><path d="M6 14V8M18 14V8M6 8h12"/></svg> },
    { id:8, name:'Glute Bridge March', muscle:'Glutes · Core · Hips', sets:'3×20', rest:'45s', diff:'medium', cal:22, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 18c0-6 4-10 8-10s8 4 8 10"/><path d="M4 18h16"/></svg> },
    { id:9, name:'Archer Push-Up', muscle:'Chest · Core · Stability', sets:'3×8 each', rest:'60s', diff:'medium', cal:30, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M2 14l8-8 4 4 8-6"/><line x1="2" y1="18" x2="22" y2="18"/></svg> },
    { id:10, name:'Hollow Body Hold', muscle:'Core · Hip Flexors', sets:'4×30s', rest:'30s', diff:'medium', cal:18, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 12c4-8 12-8 16 0"/><line x1="2" y1="12" x2="22" y2="12"/></svg> },
    { id:11, name:'Bear Crawl', muscle:'Full Body · Core', sets:'3×20m', rest:'45s', diff:'medium', cal:35, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="5" r="2"/><path d="M8 8l-4 8M16 8l4 8M8 8l4 6 4-6"/><line x1="6" y1="20" x2="18" y2="20"/></svg> },
    { id:12, name:'Deep Squat Hold', muscle:'Hips · Ankles · Quads', sets:'3×60s', rest:'30s', diff:'easy', cal:15, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="4" r="2"/><path d="M8 8h8l-1 6H9L8 8z"/><path d="M9 14l-2 6M15 14l2 6"/></svg> },
  ],
  desk: [
    { id:1, name:'Neck Flexion & Extension', muscle:'Neck · Upper Traps', sets:'2×30s', rest:'10s', diff:'easy', cal:3, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="6" r="3"/><path d="M12 9v6"/><path d="M9 12h6"/></svg> },
    { id:2, name:'Thoracic Rotation', muscle:'Thoracic Spine · Obliques', sets:'3×10 each', rest:'15s', diff:'easy', cal:4, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M12 2v20M2 12h20"/><path d="M5 5l14 14M19 5L5 19"/></svg> },
    { id:3, name:'Seated Hip Flexor Stretch', muscle:'Hip Flexors · Psoas', sets:'2×45s each', rest:'15s', diff:'easy', cal:5, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="4" y="10" width="16" height="4" rx="2"/><path d="M8 10V6M16 10V6M8 14v4M16 14v4"/></svg> },
    { id:4, name:'Wall Angels', muscle:'Shoulders · Thoracic', sets:'3×12', rest:'20s', diff:'easy', cal:6, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="5" r="2"/><path d="M12 7v5M7 10l5 2 5-2M7 10l-2 5M17 10l2 5"/></svg> },
    { id:5, name:'Chair Dips', muscle:'Triceps · Chest', sets:'3×15', rest:'30s', diff:'medium', cal:12, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 14V8M17 14V8M7 8h10"/></svg> },
    { id:6, name:'Standing Calf Raises', muscle:'Calves · Balance', sets:'3×25', rest:'20s', diff:'easy', cal:8, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M8 20V12a4 4 0 018 0v8"/><line x1="5" y1="20" x2="19" y2="20"/></svg> },
    { id:7, name:'Wrist & Forearm Stretch', muscle:'Forearms · Wrists', sets:'2×30s each', rest:'10s', diff:'easy', cal:2, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M12 2a5 5 0 015 5v5a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M12 17v5"/></svg> },
    { id:8, name:'20-20-20 Eye Rule', muscle:'Eyes · Focus', sets:'3×20s', rest:'0', diff:'easy', cal:1, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg> },
    { id:9, name:'Box Breathing', muscle:'Nervous System · Focus', sets:'4×4 counts', rest:'0', diff:'easy', cal:2, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/></svg> },
    { id:10, name:'Seated Leg Raises', muscle:'Core · Hip Flexors', sets:'3×20', rest:'30s', diff:'medium', cal:10, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="3" y="12" width="18" height="4" rx="2"/><path d="M8 12V8M16 12V8M8 8h8"/><path d="M10 16l-2 5M14 16l2 5"/></svg> },
    { id:11, name:'Shoulder Blade Squeeze', muscle:'Rhomboids · Posture', sets:'3×15', rest:'15s', diff:'easy', cal:5, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M8 6l-4 6 4 6M16 6l4 6-4 6"/><line x1="12" y1="6" x2="12" y2="18"/></svg> },
    { id:12, name:'Standing Hip Circles', muscle:'Hip Flexors · Mobility', sets:'2×20 each', rest:'15s', diff:'easy', cal:6, svg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/></svg> },
  ],
};

const DIFF = { easy: '#CCFF00', medium: '#FFA53C', hard: '#FF6B6B' };

function getCoachById(coachId) {
  return COACHES.find(c => c.id === coachId) || COACHES[0];
}

export default function CoachPage() {
  const { profile, updateCoachPersona } = useAuth() || {};
  const {
    messages,
    switchCoach,
    setCoachMessages,
    getCoachMessages,
  } = useCoachSession();
  const [coach, setCoach] = useState(() =>
    getCoachById(profile?.coach_persona) || getCoachById('elias'),
  );
  const [view, setView] = useState('chat');
  const [location, setLocation] = useState('gym');
  const [equipment, setEquipment] = useState(['barbell','dumbbell','bench','squat_rack','pull_up']);
  const [workoutTime, setWorkoutTime] = useState(30);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeEx, setActiveEx] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [groupCode, setGroupCode] = useState(null);
  const [groupInput, setGroupInput] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [animatedItems, setAnimatedItems] = useState([]);
  const [exerciseData, setExerciseData] = useState(null);
  const [loadingGif, setLoadingGif] = useState(false);
  const messagesEndRef = useRef(null);
  const audioRef = coachAudioRef;
  const sendingRef = useRef(false);
  const userXp = profile?.dopa_xp || 0;

  useEffect(() => {
    const personaId = profile?.coach_persona;
    if (!personaId) return;
    const profileCoach = getCoachById(personaId);
    if (profileCoach && profileCoach.id !== coach.id) setCoach(profileCoach);
  }, [profile?.coach_persona, coach.id]);

  const handleSelectCoach = useCallback(async selectedCoach => {
    setCoach(selectedCoach);
    setView('chat');
    if (profile?.coach_persona !== selectedCoach.id) {
      await updateCoachPersona?.(selectedCoach.id);
    }
  }, [profile?.coach_persona, updateCoachPersona]);

  useEffect(() => {
    if (view !== 'chat') return undefined;
    const frame = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, loading, view]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (!activeEx) { setExerciseData(null); return; }
    setLoadingGif(true);
    getExerciseData(activeEx.name).then(data => {
      setExerciseData(data);
      setLoadingGif(false);
    });
  }, [activeEx]);

  // Animate workout list on tab/location change
  useEffect(() => {
    if (view === 'workout') {
      setAnimatedItems([]);
      const items = WORKOUTS[location];
      items.forEach((_, i) => {
        setTimeout(() => setAnimatedItems(prev => [...prev, i]), i * 60);
      });
    }
  }, [view, location]);

  const speakCoachText = useCallback(async (text, options = {}) => {
    const isStreaming = options?.stream || typeof options?.getText === 'function';

    if (isIOSDevice()) {
      if (isStreaming && typeof options?.getText === 'function') {
        while (!options.isComplete?.()) {
          if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          await new Promise(resolve => window.setTimeout(resolve, 45));
        }

        const fullText = options.getText();
        if (!fullText?.trim()) return;
        options.onSpeechStart?.();
        return playCoachAudio(fullText.trim(), coach.id, { signal: options.signal });
      }

      const fullText = text || options?.text || '';
      if (!fullText?.trim()) return Promise.resolve();
      return playCoachAudio(fullText.trim(), coach.id, { signal: options?.signal });
    }

    if (isStreaming && typeof options?.getText === 'function') {
      return speakStreamingText(options.getText, coach.id, {
        signal: options.signal,
        isComplete: options.isComplete,
        onSpeechStart: options.onSpeechStart,
        speakSentence: (sentence, abortSignal) =>
          playCoachAudio(sentence, coach.id, { signal: abortSignal }),
      });
    }

    if (!text?.trim()) return Promise.resolve();
    return playCoachAudio(text, coach.id, { signal: options?.signal });
  }, [coach.id]);

  const speak = speakCoachText;

  const processUserMessage = useCallback(async (rawText, options = {}) => {
    const { signal, streaming = false, onToken, fromVoice = false } = options;
    const text = sanitizeTranscript(String(rawText || '').trim());
    if (!text || (!options.voiceTurn && sendingRef.current)) return null;
    if (signal?.aborted) return null;

    sendingRef.current = true;
    setInput('');
    setLoading(true);

    const userMsg = { role: 'user', text, timestamp: new Date().toISOString() };
    const currentHistory = getCoachMessages(coach.id);
    const historyWithUser = [...currentHistory, userMsg];
    setCoachMessages(coach.id, historyWithUser);

    try {
      const profileContext = buildProfileContext(profile, workoutTime, location, equipment);
      const systemPrompt = buildCoachSystemPrompt(
        coach.systemPrompt,
        coach,
        historyWithUser,
        profileContext,
      );
      const contents = toGeminiContents(historyWithUser);

      const rawReply = streaming
        ? await askGeminiChatStream({
            messages: contents,
            systemPrompt,
            signal,
            onToken: (_chunk, fullText) => {
              onToken?.(_chunk, fullText);
              setCoachMessages(coach.id, [
                ...historyWithUser,
                { role: 'assistant', text: fullText, timestamp: new Date().toISOString() },
              ]);
            },
          })
        : await askGeminiChat({ messages: contents, systemPrompt, signal });

      if (signal?.aborted) return null;

      const reply = sanitizeCoachResponse(rawReply, coach.name);

      if (reply) {
        const assistantMsg = { role: 'assistant', text: reply, timestamp: new Date().toISOString() };
        setCoachMessages(coach.id, [...historyWithUser, assistantMsg]);
      }
      return reply;
    } catch (err) {
      if (err?.name === 'AbortError') return null;
      console.error('processUserMessage error:', err);
      const errMsg = { role: 'assistant', text: 'Connection issue. Try again.', timestamp: new Date().toISOString() };
      setCoachMessages(coach.id, [...historyWithUser, errMsg]);
      return null;
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  }, [coach, profile, workoutTime, location, equipment, getCoachMessages, setCoachMessages]);

  const sendMessage = useCallback(async (rawText, { fromVoice = false } = {}) => {
    stopCoachAudio();
    const reply = await processUserMessage(rawText, { fromVoice });
    if (reply && fromVoice) await speak(reply);
  }, [processUserMessage, speak]);

  const {
    voiceState,
    liveTranscript,
    voiceSessionActive,
    toggleVoiceSession,
    stopVoiceSession,
    pauseCoachSpeech,
    VOICE_SESSION_STATE,
  } = useVoiceSession({
    processUtterance: processUserMessage,
    speakReply: (text, options) => speak(text, options),
  });

  // Back-compat alias — mic button and older bundles reference toggleVoice
  const toggleVoice = toggleVoiceSession;

  const isVoiceBusy =
    voiceState === VOICE_SESSION_STATE.SPEAKING
    || voiceState === VOICE_SESSION_STATE.PROCESSING
    || isSpeaking();

  const handleMicPress = useCallback(() => {
    if (isVoiceBusy || (voiceSessionActive && loading)) {
      pauseCoachSpeech();
      sendingRef.current = false;
      setLoading(false);
      return;
    }

    toggleVoiceSession();
  }, [isVoiceBusy, voiceSessionActive, loading, pauseCoachSpeech, toggleVoiceSession]);

  useEffect(() => () => stopVoiceSession(), [stopVoiceSession]);

  const voiceStatusLabel = {
    [VOICE_SESSION_STATE.IDLE]: 'ONLINE',
    [VOICE_SESSION_STATE.LISTENING]: 'LIVE',
    [VOICE_SESSION_STATE.PROCESSING]: 'THINKING',
    [VOICE_SESSION_STATE.SPEAKING]: 'SPEAKING',
  }[voiceState] || 'ONLINE';

  useEffect(() => {
    stopVoiceSession();
    switchCoach(coach.id, coach.greeting);
    sendingRef.current = false;
  }, [coach.id, coach.greeting, switchCoach, stopVoiceSession]);

  const createGroup = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setGroupCode(code);
    setGroupMembers([{ name: profile?.display_name || 'You', isHost: true, ready: true }]);
  };

  const joinGroup = () => {
    if (groupInput.length < 4) return;
    setGroupCode(groupInput.toUpperCase());
    setGroupMembers([
      { name: 'Alex', isHost: true, ready: true },
      { name: profile?.display_name || 'You', isHost: false, ready: false },
    ]);
    setGroupInput('');
  };

  const CoachAvatar = ({ c = coach, size = 48 }) => (
    <div className="rounded-full flex items-center justify-center font-black flex-shrink-0 transition-all duration-300"
      style={{ width: size, height: size, fontSize: size * 0.26,
        background: `linear-gradient(135deg,${c.color}28,${c.color}08)`,
        border: `2px solid ${c.color}45`, color: c.color,
        boxShadow: `0 0 16px ${c.color}20` }}>
      {c.name.slice(0,2).toUpperCase()}
    </div>
  );

  const BackBtn = () => (
    <button type="button" onClick={() => setView('chat')}
      className="flex items-center gap-2 mb-4 px-3 py-1.5 rounded-[10px] border text-[11px] font-bold transition-all active:scale-95"
      style={{ borderColor: `${coach.color}30`, color: coach.color, background: `${coach.color}08` }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
        <path d="M19 12H5M12 5l-7 7 7 7"/>
      </svg>
      Back to Coach
    </button>
  );

  // ════════════════════════════════════════
  return (
    <main className="h-[100dvh] bg-[#080808] text-white flex flex-col pb-20 overflow-hidden">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-80 h-56 rounded-full opacity-[0.035] blur-3xl transition-all duration-700"
        style={{ background: coach.color }} />

      {/* HEADER */}
      <div className="px-5 pt-14 pb-3 flex-shrink-0">
        <div className="font-['Orbitron',monospace] font-black text-[15px] tracking-[3px] mb-0.5">
          <span style={{ color: coach.color }}>∃</span>NDO <span className="text-white/30 text-[11px]">/ Coach</span>
        </div>
        <h1 className="text-[24px] font-bold">Your Coach</h1>
      </div>

      {/* NAV TABS — centered, 3 only, with labels */}
      {view === 'chat' && (
        <div className="px-5 mb-4 flex-shrink-0">
          <div className="flex gap-2 justify-center">
            {[
              { v: 'workout', label: 'Workout', icon: <><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/></> },
              { v: 'roster', label: 'Coaches', icon: <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4"/><circle cx="17" cy="11" r="3"/><path d="M21 21v-1a3 3 0 00-3-3h-2a3 3 0 00-3 3v1"/></> },
              { v: 'group', label: 'Train Together', icon: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></> },
            ].map(tab => (
              <button key={tab.v} type="button" onClick={() => setView(tab.v)}
                className="flex flex-col items-center gap-2 px-5 py-3 rounded-[18px] transition-all active:scale-95 border flex-1"
                style={{
                  background: `${coach.color}12`,
                  borderColor: `${coach.color}35`,
                  color: coach.color,
                }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                  {tab.icon}
                </svg>
                <span className="text-[10px] font-black uppercase tracking-wider leading-tight text-center">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ ROSTER ══ */}
      {view === 'roster' && (
        <div className="px-5 flex-1 overflow-y-auto">
          <BackBtn />
          <div className="space-y-3">
            {COACHES.map(c => {
              const unlocked = c.unlocked || (c.unlockXp && userXp >= c.unlockXp);
              return (
                <div key={c.id} className="rounded-[22px] border p-4 transition-all"
                  style={{
                    background: coach.id === c.id ? `${c.color}0C` : 'rgba(255,255,255,0.02)',
                    borderColor: coach.id === c.id ? `${c.color}35` : 'rgba(255,255,255,0.07)',
                    opacity: unlocked ? 1 : 0.55,
                  }}>
                  <div className="flex items-center gap-3">
                    <CoachAvatar c={c} size={52} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[14px] font-bold">{c.name}</p>
                        {c.unlocked && <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                          style={{ background: `${c.color}20`, color: c.color, border: `1px solid ${c.color}30` }}>FREE</span>}
                        {!unlocked && <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/35 font-bold">🔒 LOCKED</span>}
                      </div>
                      <p className="text-[11px] text-white/40">{c.role}</p>
                      {!unlocked && <p className="text-[10px] mt-1 font-bold" style={{ color: c.color }}>🏆 {c.unlockReq}</p>}
                      {unlocked && <p className="text-[11px] italic mt-0.5" style={{ color: `${c.color}80` }}>"{c.tagline}"</p>}
                    </div>
                    {unlocked && (
                      <button type="button" onClick={() => { void handleSelectCoach(c); }}
                        className="px-3 py-1.5 rounded-[10px] font-bold text-[11px] transition-all active:scale-95"
                        style={{ background: coach.id === c.id ? c.color : `${c.color}20`, color: coach.id === c.id ? '#000' : c.color }}>
                        {coach.id === c.id ? 'Active' : 'Select'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ WORKOUT ══ */}
      {view === 'workout' && (
        <div className="px-5 flex-1 overflow-y-auto">
          <BackBtn />

          {/* Location tabs */}
          <div className="flex gap-2 mb-4 p-1 rounded-[16px] bg-white/[0.04] border border-white/[0.06]">
            {[
              { id:'gym', label:'Gym', icon:<><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4"/><path d="M8 12h8"/></> },
              { id:'home', label:'Home', icon:<><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></> },
              { id:'desk', label:'Desk Break', icon:<><rect x="2" y="14" width="20" height="3" rx="1"/><path d="M6 17v3M18 17v3M12 14V9"/><circle cx="12" cy="7" r="2"/></> },
            ].map(loc => (
              <button key={loc.id} type="button" onClick={() => setLocation(loc.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] transition-all font-bold text-[11px]"
                style={{
                  background: location === loc.id ? `${coach.color}18` : 'transparent',
                  border: `1px solid ${location === loc.id ? coach.color + '40' : 'transparent'}`,
                  color: location === loc.id ? coach.color : 'rgba(255,255,255,0.35)',
                }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  {loc.icon}
                </svg>
                {loc.label}
              </button>
            ))}
          </div>

          {/* Equipment — gym only */}
          {location === 'gym' && (
            <div className="mb-4 rounded-[20px] border border-white/[0.07] p-4"
              style={{ background: 'rgba(255,255,255,0.02)' }}>
              <p className="text-[10px] tracking-[2px] uppercase text-white/35 font-bold mb-3">Your Equipment</p>
              <div className="grid grid-cols-4 gap-2">
                {GYM_EQUIPMENT.map(eq => {
                  const sel = equipment.includes(eq.id);
                  return (
                    <button key={eq.id} type="button"
                      onClick={() => setEquipment(prev => sel ? prev.filter(e => e !== eq.id) : [...prev, eq.id])}
                      className="rounded-[14px] p-2.5 flex flex-col items-center gap-1.5 transition-all active:scale-95 border"
                      style={{
                        background: sel ? `${coach.color}15` : 'rgba(255,255,255,0.03)',
                        borderColor: sel ? `${coach.color}45` : 'rgba(255,255,255,0.08)',
                        boxShadow: sel ? `0 0 12px ${coach.color}18` : 'none',
                        color: sel ? coach.color : 'rgba(255,255,255,0.3)',
                      }}>
                      {eq.svg}
                      <p className="text-[8px] font-bold text-center leading-tight"
                        style={{ color: sel ? coach.color : 'rgba(255,255,255,0.3)' }}>{eq.name}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Exercise list with animation */}
          <p className="text-[10px] tracking-[2.5px] uppercase text-white/35 font-bold mb-3">
            {WORKOUTS[location].length} Exercises
          </p>
          <div className="space-y-2 mb-4">
            {WORKOUTS[location].map((ex, i) => (
              <div key={ex.id}
                onClick={() => { setActiveEx(ex); setCountdown(3); }}
                className="rounded-[18px] border p-4 flex items-center justify-between cursor-pointer transition-all duration-200 active:scale-[0.98]"
                style={{
                  background: activeEx?.id === ex.id ? `${coach.color}10` : 'rgba(255,255,255,0.025)',
                  borderColor: activeEx?.id === ex.id ? `${coach.color}35` : 'rgba(255,255,255,0.07)',
                  opacity: animatedItems.includes(i) ? 1 : 0,
                  transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(16px)',
                  transition: `opacity 0.3s ease ${i * 0.04}s, transform 0.3s ease ${i * 0.04}s, background 0.2s, border-color 0.2s`,
                  boxShadow: activeEx?.id === ex.id ? `0 0 20px ${coach.color}12` : 'none',
                }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      background: `${DIFF[ex.diff]}12`,
                      border: `1px solid ${DIFF[ex.diff]}25`,
                      color: DIFF[ex.diff],
                    }}>
                    {ex.svg}
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-white">{ex.name}</p>
                    <p className="text-[10px] text-white/35 mt-0.5">{ex.muscle}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-[12px] font-black" style={{ color: coach.color }}>{ex.sets}</p>
                  <div className="flex items-center gap-1 justify-end mt-0.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                      style={{ background: `${DIFF[ex.diff]}15`, color: DIFF[ex.diff] }}>
                      {ex.diff}
                    </span>
                    <span className="text-[9px] text-white/25">~{ex.cal}cal</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="button"
            onClick={() => {
              sendMessage(`Create a detailed ${workoutTime}-min ${location} workout plan${location === 'gym' ? ' with equipment: ' + equipment.join(', ') : ''}`);
              setView('chat');
            }}
            className="w-full py-4 rounded-[18px] font-black text-[13px] text-black mb-2 transition-all active:scale-95"
            style={{ background: coach.color, boxShadow: `0 8px 24px ${coach.color}40` }}>
            Get AI Workout Plan from {coach.name}
          </button>
        </div>
      )}

      {/* ══ GROUP ══ */}
      {view === 'group' && (
        <div className="px-5 flex-1 overflow-y-auto">
          <BackBtn />
          {!groupCode ? (
            <div className="space-y-3">
              <div className="rounded-[22px] border border-white/[0.07] p-5"
                style={{ background: 'rgba(255,255,255,0.025)' }}>
                <div className="w-12 h-12 rounded-[16px] flex items-center justify-center mb-3"
                  style={{ background: `${coach.color}15`, border: `1px solid ${coach.color}25`, color: coach.color }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </div>
                <h3 className="text-[16px] font-bold mb-1">Create Session</h3>
                <p className="text-[12px] text-white/40 mb-4">Start a group workout and invite up to 4 friends</p>
                <button type="button" onClick={createGroup}
                  className="w-full py-3.5 rounded-[14px] font-black text-[13px] text-black transition-all active:scale-95"
                  style={{ background: coach.color, boxShadow: `0 6px 20px ${coach.color}40` }}>
                  Create Group Session
                </button>
              </div>
              <div className="rounded-[22px] border border-white/[0.07] p-5"
                style={{ background: 'rgba(255,255,255,0.025)' }}>
                <h3 className="text-[16px] font-bold mb-1">Join Session</h3>
                <p className="text-[12px] text-white/40 mb-3">Enter a code from your training partner</p>
                <div className="flex gap-2">
                  <input type="text" placeholder="ENTER CODE" value={groupInput}
                    onChange={e => setGroupInput(e.target.value.toUpperCase())} maxLength={6}
                    className="flex-1 px-4 py-3 rounded-[12px] bg-white/[0.06] border border-white/[0.1] text-white placeholder-white/20 outline-none text-[15px] font-black tracking-[4px] text-center" />
                  <button type="button" onClick={joinGroup}
                    className="px-4 py-3 rounded-[12px] font-black text-[12px] transition-all active:scale-95"
                    style={{ background: `${coach.color}20`, color: coach.color, border: `1px solid ${coach.color}30` }}>
                    Join
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-[22px] border p-5"
                style={{ background: `${coach.color}08`, borderColor: `${coach.color}25` }}>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-[10px] text-white/35 uppercase tracking-wider mb-1">Session Code</p>
                    <p className="text-[36px] font-black tracking-[8px]" style={{ color: coach.color }}>{groupCode}</p>
                  </div>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(groupCode)}
                    className="px-3 py-2 rounded-[10px] text-[11px] font-bold border active:scale-95"
                    style={{ borderColor: `${coach.color}30`, color: coach.color, background: `${coach.color}10` }}>
                    Copy
                  </button>
                </div>
                <div className="space-y-2 mb-4">
                  {groupMembers.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-[12px] p-3"
                      style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-[11px]"
                        style={{ background: `${coach.color}20`, color: coach.color }}>
                        {m.name.slice(0,2).toUpperCase()}
                      </div>
                      <p className="text-[13px] font-bold flex-1">{m.name}</p>
                      {m.isHost && <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                        style={{ background: `${coach.color}20`, color: coach.color }}>HOST</span>}
                      <div className="w-2 h-2 rounded-full" style={{ background: m.ready ? '#CCFF00' : '#666', boxShadow: m.ready ? '0 0 6px #CCFF00' : 'none' }} />
                    </div>
                  ))}
                  {groupMembers.length < 5 && (
                    <div className="flex items-center gap-3 rounded-[12px] p-3 border border-dashed" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                      <div className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>
                      </div>
                      <p className="text-[12px] text-white/20">Waiting for members...</p>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => { setView('workout'); }}
                  className="w-full py-4 rounded-[16px] font-black text-[14px] text-black transition-all active:scale-95"
                  style={{ background: coach.color, boxShadow: `0 8px 24px ${coach.color}50` }}>
                  🚀 Start Group Workout
                </button>
              </div>
              <button type="button" onClick={() => { setGroupCode(null); setGroupMembers([]); }}
                className="w-full py-3 rounded-[14px] text-[13px] text-white/40 border border-white/[0.08] font-bold">
                Leave Session
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ CHAT ══ */}
      {view === 'chat' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Coach card + mic */}
          <div className="mx-5 mb-3 rounded-[20px] border p-4 flex items-center gap-3 flex-shrink-0"
            style={{
              background: `linear-gradient(135deg,${coach.color}0C,rgba(255,255,255,0.015))`,
              borderColor: `${coach.color}22`,
              boxShadow: `0 6px 24px rgba(0,0,0,0.4), inset 0 1px 0 ${coach.color}12`,
            }}>
            <CoachAvatar size={50} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-bold">{coach.name}</p>
                <span className="text-[8px] px-2 py-0.5 rounded-full font-bold"
                  style={{ background: `${coach.color}20`, color: coach.color, border: `1px solid ${coach.color}30` }}>
                  {voiceStatusLabel}
                </span>
              </div>
              <p className="text-[11px] text-white/35">{coach.role}</p>
              {voiceSessionActive && (
                <p className="text-[10px] mt-1" style={{ color: coach.color }}>
                  {voiceState === VOICE_SESSION_STATE.LISTENING && liveTranscript
                    ? `"${liveTranscript}"`
                    : voiceState === VOICE_SESSION_STATE.LISTENING
                      ? 'Walkie-talkie on — tap mic to end'
                      : voiceState === VOICE_SESSION_STATE.PROCESSING
                        ? 'Processing...'
                        : 'Coach is speaking...'}
                </p>
              )}
            </div>
            {(voiceState === VOICE_SESSION_STATE.SPEAKING || isSpeaking()) && (
              <button
                type="button"
                onClick={pauseCoachSpeech}
                className="flex-shrink-0 px-3 py-2 rounded-[12px] text-[10px] font-bold border transition-all active:scale-95"
                style={{ borderColor: `${coach.color}40`, color: coach.color, background: `${coach.color}10` }}
                aria-label="Pause coach audio">
                Pause
              </button>
            )}
            <button type="button" onClick={handleMicPress}
              aria-label={
                isVoiceBusy
                  ? 'Interrupt coach'
                  : voiceSessionActive
                    ? 'End voice session'
                    : 'Start voice session'
              }
              aria-pressed={voiceSessionActive}
              className="w-13 h-13 rounded-full flex items-center justify-center transition-all active:scale-90 flex-shrink-0"
              style={{
                width: 52, height: 52,
                background: voiceSessionActive ? coach.color : `${coach.color}15`,
                border: `2px solid ${coach.color}50`,
                boxShadow: isVoiceBusy
                  ? `0 0 0 6px ${coach.color}35, 0 0 28px ${coach.color}70`
                  : voiceSessionActive
                    ? `0 0 0 6px ${coach.color}20, 0 0 0 12px ${coach.color}08, 0 0 28px ${coach.color}60`
                    : `0 0 14px ${coach.color}20`,
              }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={voiceSessionActive ? '#000' : coach.color}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                {voiceSessionActive ? (
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                ) : (
                  <>
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                  </>
                )}
              </svg>
            </button>
          </div>

          {/* Time */}
          <div className="mx-5 mb-3 grid grid-cols-4 gap-2 flex-shrink-0">
            {[{v:15,l:'15m',s:'Quick'},{v:30,l:'30m',s:'Standard'},{v:45,l:'45m',s:'Full'},{v:60,l:'60m+',s:'Beast'}].map(t => (
              <button key={t.v} type="button" onClick={() => setWorkoutTime(t.v)}
                className="rounded-[12px] py-2 text-center transition-all active:scale-95 border"
                style={{
                  background: workoutTime === t.v ? `${coach.color}15` : 'rgba(255,255,255,0.03)',
                  borderColor: workoutTime === t.v ? `${coach.color}40` : 'rgba(255,255,255,0.07)',
                }}>
                <p className="text-[12px] font-bold" style={{ color: workoutTime === t.v ? coach.color : 'rgba(255,255,255,0.6)' }}>{t.l}</p>
                <p className="text-[8px] text-white/25">{t.s}</p>
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 space-y-3 pb-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role==='user'?'justify-end':'justify-start'} gap-2`}>
                {msg.role==='assistant' && <CoachAvatar size={30} />}
                <div className="max-w-[78%] rounded-[16px] px-4 py-3"
                  style={msg.role === 'user'
                    ? { background: 'rgba(255,255,255,0.08)', borderRadius: '16px 16px 4px 16px' }
                    : { background: `${coach.color}10`, border: `1px solid ${coach.color}20`, borderRadius: '16px 16px 16px 4px' }}>
                  <p className="text-[13px] leading-relaxed text-white whitespace-pre-wrap break-words">{msg.text}</p>
                  <span style={{ fontSize: 9, color: '#444', marginTop: 2, display: 'block' }}>
                    {msg.timestamp
                      ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <CoachAvatar size={30} />
                <div className="rounded-[16px] px-4 py-3 flex gap-1.5 items-center"
                  style={{ background:`${coach.color}10`, border:`1px solid ${coach.color}20` }}>
                  {[0,1,2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ background:coach.color, animationDelay:`${i*0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-5 flex-shrink-0 pb-2">
            <div className="flex gap-2 items-center p-2.5 rounded-[18px] border"
              style={{ background:'rgba(255,255,255,0.04)', borderColor:'rgba(255,255,255,0.09)' }}>
              <input type="text" value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage(input, { fromVoice: false })}
                placeholder={`Ask ${coach.name}...`}
                className="flex-1 bg-transparent text-[13px] text-white placeholder-white/25 outline-none px-2" />
              <button type="button" onClick={() => sendMessage(input, { fromVoice: false })}
                disabled={!input.trim()||loading}
                className="w-9 h-9 rounded-[11px] flex items-center justify-center transition-all active:scale-90 flex-shrink-0"
                style={{ background:input.trim()?coach.color:'rgba(255,255,255,0.06)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke={input.trim()?'#000':'rgba(255,255,255,0.25)'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXERCISE OVERLAY */}
      {activeEx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(16px)' }}>
          <div className="w-full max-w-[390px] rounded-[32px] flex flex-col"
            style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.1)', maxHeight: '88vh' }}>
          <div className="overflow-y-auto flex-1">

            {countdown !== null && countdown > 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-8">
                <p className="text-[13px] text-white/40 uppercase tracking-widest mb-6">Get Ready</p>
                <div className="text-[120px] font-black leading-none mb-6"
                  style={{ color: coach.color, filter: `drop-shadow(0 0 40px ${coach.color})`, animation: 'scaleIn 0.3s ease' }}>
                  {countdown}
                </div>
                <p className="text-[20px] font-bold text-white text-center">{activeEx.name}</p>
              </div>
            ) : (
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-14 h-14 rounded-[16px] flex items-center justify-center flex-shrink-0"
                    style={{ background: `${DIFF[activeEx.diff]}12`, border: `1px solid ${DIFF[activeEx.diff]}25`, color: DIFF[activeEx.diff] }}>
                    <div className="w-7 h-7">{activeEx.svg}</div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[20px] font-black text-white leading-tight">{activeEx.name}</h3>
                    <p className="text-[12px] text-white/40 mt-0.5">{activeEx.muscle}</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { l: 'Sets', v: activeEx.sets },
                    { l: 'Rest', v: activeEx.rest },
                    { l: 'Level', v: activeEx.diff },
                  ].map(s => (
                    <div key={s.l} className="rounded-[14px] p-3 text-center border border-white/[0.07]"
                      style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <p className="text-[9px] text-white/35 uppercase tracking-wider mb-1">{s.l}</p>
                      <p className="text-[15px] font-black" style={{ color: coach.color }}>{s.v}</p>
                    </div>
                  ))}
                </div>

                {/* Animation area */}
                <div className="rounded-[20px] border border-white/[0.07] overflow-hidden mb-5 relative"
                  style={{ background: `${coach.color}06` }}>
                  {loadingGif ? (
                    <div className="h-[140px] flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 animate-spin"
                        style={{ borderColor: `${coach.color}30`, borderTopColor: coach.color }} />
                      <p className="text-[11px] text-white/30">Loading...</p>
                    </div>
                  ) : exerciseData ? (
                    <div>
                      {/* GIF */}
                      {exerciseData.gifUrl && (
                        <img
                          src={exerciseData.gifUrl}
                          alt={activeEx.name}
                          className="w-full h-[200px] object-cover"
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      )}
                      {/* Muscle info */}
                      <div className="p-4 flex gap-3 flex-wrap border-b border-white/[0.06]">
                        {[
                          { label: 'Target', val: exerciseData.target },
                          { label: 'Body Part', val: exerciseData.bodyPart },
                          { label: 'Equipment', val: exerciseData.equipment },
                        ].map(m => m.val && (
                          <div key={m.label} className="flex-1 min-w-[80px] rounded-[10px] py-2 px-3 text-center border border-white/[0.07]"
                            style={{ background: `${coach.color}0C` }}>
                            <p className="text-[9px] text-white/35 uppercase tracking-wider mb-0.5">{m.label}</p>
                            <p className="text-[11px] font-bold capitalize" style={{ color: coach.color }}>{m.val}</p>
                          </div>
                        ))}
                      </div>
                      {/* Instructions */}
                      {exerciseData.instructions?.length > 0 && (
                        <div className="p-4">
                          <p className="text-[10px] tracking-[2px] uppercase text-white/35 font-bold mb-3">How to perform</p>
                          <div className="space-y-2.5">
                            {exerciseData.instructions.slice(0, 4).map((step, i) => (
                              <div key={i} className="flex gap-3">
                                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black mt-0.5"
                                  style={{ background: `${coach.color}20`, color: coach.color }}>
                                  {i + 1}
                                </div>
                                <p className="text-[12px] text-white/60 leading-relaxed flex-1">{step}</p>
                              </div>
                            ))}
                          </div>
                          {exerciseData.secondaryMuscles?.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/[0.06]">
                              <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1.5">Secondary muscles</p>
                              <div className="flex flex-wrap gap-1.5">
                                {exerciseData.secondaryMuscles.map(m => (
                                  <span key={m} className="text-[10px] px-2 py-0.5 rounded-full capitalize"
                                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                                    {m}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-[140px] flex flex-col items-center justify-center gap-2">
                      <div style={{ color: coach.color, animation: 'bounce 0.9s ease-in-out infinite' }}>
                        <div className="w-12 h-12">{activeEx.svg}</div>
                      </div>
                      <p className="text-[11px] text-white/35">Tap "Ask Coach" for form tips</p>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]"
                    style={{ background: `linear-gradient(90deg,transparent,${coach.color},transparent)` }} />
                </div>
              </div>
            )}
          </div>
          {/* Sticky buttons */}
          {countdown === null || countdown <= 0 ? (
            <div className="grid grid-cols-3 gap-2 p-4 border-t border-white/[0.07]"
              style={{ background: '#0f0f0f' }}>
              <button type="button"
                onClick={() => { setActiveEx(null); setCountdown(null); }}
                className="py-3.5 rounded-[14px] font-bold text-[12px] border transition-all active:scale-95"
                style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.04)' }}>
                ← Back
              </button>
              <button type="button"
                onClick={() => { sendMessage(`How do I perform ${activeEx?.name} with perfect form?`); setActiveEx(null); setView('chat'); }}
                className="py-3.5 rounded-[14px] font-bold text-[12px] border transition-all active:scale-95"
                style={{ borderColor: `${coach.color}30`, color: coach.color, background: `${coach.color}10` }}>
                Ask Coach
              </button>
              <button type="button"
                onClick={() => { setActiveEx(null); setCountdown(null); }}
                className="py-3.5 rounded-[14px] font-black text-[13px] text-black transition-all active:scale-95"
                style={{ background: coach.color, boxShadow: `0 6px 20px ${coach.color}40` }}>
                Done ✓
              </button>
            </div>
          ) : null}
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
        @keyframes scaleIn { from{transform:scale(1.4);opacity:0} to{transform:scale(1);opacity:1} }
      `}</style>
    </main>
  );
}
