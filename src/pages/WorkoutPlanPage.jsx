import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { generateWorkoutPlan, getFallbackWorkoutPlan } from "../lib/gemini";

const ex = (name, sets, reps, rest) => ({ name, sets, reps, rest });

const FALLBACK_PLAN = (coachId) => ({
  coachId,
  days: [
    {
      day: "Saturday",
      focus: "Push",
      type: "training",
      exercises: [
        ex("Bench Press", "4", "8-10", "90s"),
        ex("OHP", "3", "8-10", "90s"),
        ex("Incline DB Press", "3", "10-12", "60s"),
        ex("Lateral Raise", "3", "15", "45s"),
        ex("Tricep Pushdown", "3", "12-15", "45s"),
        ex("Cable Fly", "3", "12-15", "45s"),
        ex("Dips", "3", "10-12", "60s"),
      ],
    },
    {
      day: "Sunday",
      focus: "Pull",
      type: "training",
      exercises: [
        ex("Deadlift", "4", "5", "120s"),
        ex("Barbell Row", "3", "8-10", "90s"),
        ex("Lat Pulldown", "3", "10-12", "60s"),
        ex("Face Pull", "3", "15", "45s"),
        ex("Bicep Curl", "3", "10-12", "60s"),
        ex("Hammer Curl", "3", "12", "45s"),
        ex("Rear Delt Fly", "3", "15", "45s"),
      ],
    },
    {
      day: "Monday",
      focus: "Active Rest",
      type: "rest",
      exercises: [
        ex("30 min walk", "-", "-", "-"),
        ex("Light stretching", "-", "10 min", "-"),
      ],
    },
    {
      day: "Tuesday",
      focus: "Legs",
      type: "training",
      exercises: [
        ex("Squat", "4", "8", "120s"),
        ex("Leg Press", "3", "12", "90s"),
        ex("Romanian Deadlift", "3", "10", "90s"),
        ex("Leg Curl", "3", "12", "60s"),
        ex("Leg Extension", "3", "12", "60s"),
        ex("Calf Raise", "4", "15", "45s"),
        ex("Hip Thrust", "3", "12", "60s"),
      ],
    },
    {
      day: "Wednesday",
      focus: "Core + Cardio",
      type: "training",
      exercises: [
        ex("Plank", "3", "60s", "45s"),
        ex("Crunches", "3", "20", "45s"),
        ex("Russian Twist", "3", "20", "45s"),
        ex("Mountain Climber", "3", "30s", "30s"),
        ex("Bicycle Crunch", "3", "20", "45s"),
        ex("Dead Bug", "3", "12", "45s"),
        ex("Hollow Hold", "3", "30s", "45s"),
      ],
    },
    {
      day: "Thursday",
      focus: "Upper Body Mix",
      type: "training",
      exercises: [
        ex("Pull Up", "3", "8", "90s"),
        ex("Dip", "3", "10-12", "60s"),
        ex("DB Shoulder Press", "3", "10", "60s"),
        ex("Cable Row", "3", "10-12", "60s"),
        ex("Chest Fly", "3", "12-15", "45s"),
        ex("Tricep Extension", "3", "12", "45s"),
        ex("Shrug", "3", "12-15", "45s"),
      ],
    },
    {
      day: "Friday",
      focus: "Full Rest",
      type: "rest",
      exercises: [
        ex("Recovery", "-", "-", "-"),
      ],
    },
  ],
});

function logFallbackTemplateVerification(coachId = "aria") {
  const template = FALLBACK_PLAN(coachId);
  const summary = template.days.map((d) => ({
    day: d.day,
    focus: d.focus,
    type: d.type,
    exerciseCount: d.exercises?.length ?? 0,
    exercises: d.exercises?.map((e) => e.name),
  }));
  console.log("[WorkoutPlan] Fallback template exercise counts:", summary);
  console.log("[WorkoutPlan] Fallback template full:", template);
  return template;
}

function logPlanSource(label, planData) {
  const summary = planData?.days?.map((d) => ({
    day: d.day,
    exerciseCount: d.exercises?.length ?? 0,
  }));
  console.log(`[WorkoutPlan] ${label}`, summary);
}

logFallbackTemplateVerification();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function is503Error(err) {
  const msg = err?.message || String(err);
  return msg.includes("503") || err?.status === 503;
}

async function generateWorkoutPlanWithRetry(coach, user, userProfile) {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await generateWorkoutPlan(coach, user, userProfile);
    } catch (err) {
      if (is503Error(err) && attempt < maxRetries) {
        console.warn(`Gemini 503, retrying in 3s (attempt ${attempt + 1}/${maxRetries + 1})...`);
        await sleep(3000);
        continue;
      }
      throw err;
    }
  }
}

const ACTIVE_DAY_COLOR = "#CCFF00";

const COACH_COLORS = {
  aria:  { accent: "#00FFFF", label: "Aria" },
  kane:  { accent: "#FF4500", label: "Kane" },
  blaze: { accent: "#FF6B00", label: "Blaze" },
  nova:  { accent: "#A855F7", label: "Nova" },
  zara:  { accent: "#00FF88", label: "Zara" },
};

const EQUIPMENT_MAP = {
  full_gym:   "full_gym",
  home:       "home_basic",
  bodyweight: "bodyweight",
};

export default function WorkoutPlanPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [plan, setPlan] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeDay, setActiveDay] = useState(null);

  const coach = profile?.coach_persona || profile?.selected_coach || profile?.current_coach || profile?.coach_id || "aria";
  const { accent, label } = COACH_COLORS[coach] || COACH_COLORS.aria;

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const profileData = await fetchProfile();
    const hasPlan = profileData ? await loadPlan(profileData.gender) : false;
    setLoading(false);
    if (!hasPlan && profileData) {
      generatePlan(profileData);
    }
  }

  async function fetchProfile() {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, gender, experience, goal, equipment, health_conditions, injuries, age, weight_kg, activity, coach_persona, selected_coach, current_coach, coach_id")
        .eq("id", user.id)
        .single();
      if (data) {
        setProfile(data);
        return data;
      }
    } catch (_) {}
    return null;
  }

  async function deleteUserWorkoutPlans() {
    if (!user?.id) return;
    const { error } = await supabase
      .from("workout_plans")
      .delete()
      .eq("user_id", user.id);
    if (error) {
      console.error("[WorkoutPlan] Failed to delete workout plans:", error);
    }
  }

  function normalizeGender(gender) {
    return String(gender || "male").toLowerCase();
  }

  async function loadPlan(profileGender) {
    const expectedGender = normalizeGender(profileGender);

    try {
      const { data } = await supabase
        .from("workout_plans")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("generated_at", { ascending: false })
        .limit(1)
        .single();

      if (data?.plan_data) {
        const cachedGender = normalizeGender(data.plan_data.gender);

        if (!data.plan_data.gender || cachedGender !== expectedGender) {
          console.log("[WorkoutPlan] Cached plan gender mismatch, deleting and regenerating", {
            cachedGender: data.plan_data.gender || null,
            expectedGender,
          });
          await deleteUserWorkoutPlans();
          return false;
        }

        logPlanSource(
          `Loaded from Supabase (cached plan, id=${data.id}, generated_at=${data.generated_at}, gender=${cachedGender})`,
          data.plan_data,
        );
        setPlan(data.plan_data);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async function refreshPlan() {
    if (generating) return;
    await deleteUserWorkoutPlans();
    setPlan(null);
    await generatePlan();
  }

  async function generatePlan(profileOverride) {
    setGenerating(true);

    const activeProfile = profileOverride || profile;
    const activeCoach = activeProfile?.coach_persona || activeProfile?.selected_coach || activeProfile?.current_coach || activeProfile?.coach_id || coach;
    const profileGender = normalizeGender(activeProfile?.gender);

    const userProfile = {
      fitnessLevel: activeProfile?.experience || "beginner",
      availableEquipment: activeProfile?.equipment || "full_gym",
      goal: activeProfile?.goal || "general fitness",
      injuries: activeProfile?.injuries || activeProfile?.health_conditions || "none",
      age: activeProfile?.age || null,
      weight: activeProfile?.weight_kg || null,
      isReturning: false,
      setting: "gym",
    };

    let planSource = "gemini";
    let planData;
    try {
      planData = await generateWorkoutPlanWithRetry(activeCoach, user, userProfile);
      logPlanSource("Generated via Gemini", planData);
    } catch (e) {
      console.error("Gemini failed, using fallback:", e);
      planData = getFallbackWorkoutPlan(activeCoach, profileGender, activeProfile?.session_duration);
      planSource = "fallback";
      logPlanSource("Using gender-aware FALLBACK template", planData);
    }

    planData = { ...planData, gender: profileGender };

    await deleteUserWorkoutPlans();

    await supabase.from("workout_plans").insert({
      user_id: user.id,
      coach_id: activeCoach,
      plan_data: planData,
      week_start: new Date().toISOString().split("T")[0],
      is_active: true,
    });

    console.log(`[WorkoutPlan] Saved new plan (source=${planSource})`);
    setPlan(planData);
    setGenerating(false);
  }

  const days = plan?.days || [];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "sans-serif", paddingBottom: "100px" }}>

      {/* Header */}
      <div style={{ padding: "20px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate('/')} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>←</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Weekly Plan</h1>
            <p style={{ margin: 0, fontSize: 12, color: accent }}>Coach {label}</p>
          </div>
        </div>
        {plan && (
          <button
            onClick={refreshPlan}
            disabled={generating}
            style={{ background: "transparent", border: `1px solid ${ACTIVE_DAY_COLOR}`, color: ACTIVE_DAY_COLOR, borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: generating ? "wait" : "pointer", opacity: generating ? 0.6 : 1 }}
          >
            {generating ? "..." : "Refresh Plan"}
          </button>
        )}
      </div>

      <div style={{ padding: "20px 16px" }}>
        {loading || generating ? (
          <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
            {generating ? "Building your plan..." : "Loading..."}
          </div>
        ) : !plan ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏋️</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>No plan yet</h2>
            <p style={{ color: "#666", fontSize: 14 }}>
              Coach {label} is preparing your weekly plan
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {days.map((d, i) => (
              <div
                key={i}
                onClick={() => setActiveDay(activeDay === i ? null : i)}
                style={{ background: "#111", border: `1px solid ${activeDay === i ? ACTIVE_DAY_COLOR : d.type === "rest" ? "#1a1a1a" : "#222"}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", opacity: d.type === "rest" ? 0.6 : 1 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: d.type === "rest" ? "#1a1a1a" : `${ACTIVE_DAY_COLOR}22`, color: d.type === "rest" ? "#444" : ACTIVE_DAY_COLOR, fontWeight: 600 }}>
                      {d.type === "rest" ? "REST" : "TRAIN"}
                    </span>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{d.day}</span>
                      <span style={{ color: "#555", fontSize: 12, marginLeft: 8 }}>— {d.focus}</span>
                    </div>
                  </div>
                  <span style={{ color: ACTIVE_DAY_COLOR, fontSize: 14 }}>{activeDay === i ? "▲" : "▼"}</span>
                </div>

                {activeDay === i && d.exercises?.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 12px", fontSize: 11, color: "#555", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #1a1a1a" }}>
                      <span>Exercise</span><span>Sets</span><span>Reps</span><span>Rest</span>
                    </div>
                    {d.exercises.map((ex, j) => (
                      <div key={j} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 12px", padding: "7px 0", borderBottom: j < d.exercises.length - 1 ? "1px solid #1a1a1a" : "none", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#ddd" }}>{ex.name}</span>
                        <span style={{ fontSize: 12, color: accent, fontWeight: 600 }}>{ex.sets}</span>
                        <span style={{ fontSize: 12, color: "#aaa" }}>{ex.reps}</span>
                        <span style={{ fontSize: 11, color: "#555" }}>{ex.rest}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
