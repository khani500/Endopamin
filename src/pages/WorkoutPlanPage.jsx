import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { generateWorkoutPlan } from "../lib/gemini";

const FALLBACK_PLAN = (coachId) => ({
  coachId,
  days: [
    { day: "Saturday",  focus: "Push — Chest / Shoulder / Tricep", type: "training", exercises: [{ name: "Bench Press", sets: "3", reps: "12-15", rest: "60s" }, { name: "OHP", sets: "3", reps: "10", rest: "60s" }, { name: "Lateral Raise", sets: "3", reps: "15", rest: "45s" }] },
    { day: "Sunday",    focus: "Pull — Back / Bicep",              type: "training", exercises: [{ name: "Deadlift", sets: "4", reps: "5", rest: "120s" }, { name: "Pull-up", sets: "3", reps: "8", rest: "90s" }, { name: "Hammer Curl", sets: "3", reps: "12", rest: "60s" }] },
    { day: "Monday",    focus: "Active Rest",                      type: "rest",     exercises: [{ name: "30 min walk", sets: "-", reps: "-", rest: "-" }, { name: "Stretching", sets: "-", reps: "10 min", rest: "-" }] },
    { day: "Tuesday",   focus: "Legs",                             type: "training", exercises: [{ name: "Squat", sets: "4", reps: "8", rest: "120s" }, { name: "Romanian Deadlift", sets: "3", reps: "10", rest: "90s" }, { name: "Calf Raise", sets: "4", reps: "15", rest: "45s" }] },
    { day: "Wednesday", focus: "Core + Cardio",                    type: "training", exercises: [{ name: "Plank", sets: "3", reps: "60s", rest: "45s" }, { name: "Mountain Climber", sets: "3", reps: "20", rest: "45s" }] },
    { day: "Thursday",  focus: "Upper Body Mix",                   type: "training", exercises: [{ name: "Incline Press", sets: "3", reps: "10", rest: "60s" }, { name: "Face Pull", sets: "3", reps: "15", rest: "45s" }, { name: "Bicep Curl", sets: "3", reps: "12", rest: "60s" }] },
    { day: "Friday",    focus: "Full Rest",                        type: "rest",     exercises: [{ name: "Recovery", sets: "-", reps: "-", rest: "-" }] },
  ],
});

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
  const [showConfirm, setShowConfirm] = useState(false);

  const coach = profile?.coach_persona || profile?.selected_coach || profile?.current_coach || profile?.coach_id || "aria";
  const { accent, label } = COACH_COLORS[coach] || COACH_COLORS.aria;

  const isMonday = new Date().getDay() === 1;

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    await fetchProfile();
    await loadPlan();
    setLoading(false);
  }

  async function fetchProfile() {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, experience, goal, equipment, health_conditions, injuries, age, weight_kg, activity, coach_persona, selected_coach, current_coach, coach_id")
        .eq("id", user.id)
        .single();
      if (data) setProfile(data);
    } catch (_) {}
  }

  async function loadPlan() {
    try {
      const { data } = await supabase
        .from("workout_plans")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("generated_at", { ascending: false })
        .limit(1)
        .single();
      if (data) setPlan(data.plan_data);
    } catch (_) {}
  }

  function handleNewPlanClick() {
    if (!plan || isMonday) {
      generatePlan();
    } else {
      setShowConfirm(true);
    }
  }

  async function generatePlan() {
    setShowConfirm(false);
    setGenerating(true);

    const userProfile = {
      fitnessLevel: profile?.experience || "beginner",
      availableEquipment: EQUIPMENT_MAP[profile?.activity] || "full_gym",
      goal: profile?.goal || "general fitness",
      injuries: profile?.injuries || profile?.health_conditions || "none",
      age: profile?.age || null,
      weight: profile?.weight_kg || null,
      isReturning: false,
      setting: "gym",
    };

    let planData;
    try {
      planData = await generateWorkoutPlan(coach, user, userProfile);
    } catch (e) {
      console.error("Gemini failed, using fallback:", e);
      planData = FALLBACK_PLAN(coach);
    }

    await supabase
      .from("workout_plans")
      .update({ is_active: false })
      .eq("user_id", user.id);

    await supabase.from("workout_plans").insert({
      user_id: user.id,
      coach_id: coach,
      plan_data: planData,
      week_start: new Date().toISOString().split("T")[0],
    });

    setPlan(planData);
    setGenerating(false);
  }

  const days = plan?.days || [];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "sans-serif", paddingBottom: "100px" }}>

      {/* Confirm Modal */}
      {showConfirm && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "0 24px" }}>
          <div style={{ background: "#111", border: "1px solid #333", borderRadius: 20, padding: "28px 24px", maxWidth: 340, width: "100%" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700 }}>Reset your plan?</h3>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888", lineHeight: 1.6 }}>
              Building a new plan will replace your current week. Your progress history is saved.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{ flex: 1, background: "#1a1a1a", border: "1px solid #333", color: "#fff", borderRadius: 12, padding: "12px", fontSize: 14, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={generatePlan}
                style={{ flex: 1, background: accent, border: "none", color: "#000", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                Reset & Rebuild
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: "20px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>←</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Weekly Plan</h1>
            <p style={{ margin: 0, fontSize: 12, color: accent }}>Coach {label}</p>
          </div>
        </div>
        {plan && (
          <button
            onClick={handleNewPlanClick}
            disabled={generating}
            style={{ background: "transparent", border: `1px solid ${accent}`, color: accent, borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer" }}
          >
            {generating ? "..." : "🔄 New Plan"}
          </button>
        )}
      </div>

      <div style={{ padding: "20px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#555" }}>Loading...</div>
        ) : !plan ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏋️</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>No plan yet</h2>
            <p style={{ color: "#666", marginBottom: 32, fontSize: 14 }}>
              Coach {label} will build a personalized weekly plan based on your profile
            </p>
            <button
              onClick={handleNewPlanClick}
              disabled={generating}
              style={{ background: accent, color: "#000", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              {generating ? "Building your plan..." : `Build with ${label} ⚡`}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {days.map((d, i) => (
              <div
                key={i}
                onClick={() => setActiveDay(activeDay === i ? null : i)}
                style={{ background: "#111", border: `1px solid ${activeDay === i ? accent : d.type === "rest" ? "#1a1a1a" : "#222"}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", opacity: d.type === "rest" ? 0.6 : 1 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: d.type === "rest" ? "#1a1a1a" : `${accent}22`, color: d.type === "rest" ? "#444" : accent, fontWeight: 600 }}>
                      {d.type === "rest" ? "REST" : "TRAIN"}
                    </span>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{d.day}</span>
                      <span style={{ color: "#555", fontSize: 12, marginLeft: 8 }}>— {d.focus}</span>
                    </div>
                  </div>
                  <span style={{ color: accent, fontSize: 14 }}>{activeDay === i ? "▲" : "▼"}</span>
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
