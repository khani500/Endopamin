import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCoach } from "../hooks/useCoach";
import { supabase } from "../lib/supabase";
import { generateWorkoutPlan } from "../lib/gemini";

const FALLBACK_PLAN = (coachId) => ({
  coachId,
  days: [
    { day: "Saturday",  focus: "Push — Chest / Shoulder / Tricep", exercises: ["Bench Press 4×8", "OHP 3×10", "Lateral Raise 3×15", "Tricep Pushdown 3×12"] },
    { day: "Sunday",    focus: "Pull — Back / Bicep",              exercises: ["Deadlift 4×5", "Pull-up 3×8", "Cable Row 3×12", "Hammer Curl 3×12"] },
    { day: "Monday",    focus: "Active Rest",                      exercises: ["30 min walk", "Foam Rolling", "Stretching"] },
    { day: "Tuesday",   focus: "Legs",                             exercises: ["Squat 4×8", "Romanian Deadlift 3×10", "Leg Press 3×12", "Calf Raise 4×15"] },
    { day: "Wednesday", focus: "Core + Cardio",                    exercises: ["Plank 3×60s", "Ab Wheel 3×12", "Mountain Climber 3×20", "HIIT 15 min"] },
    { day: "Thursday",  focus: "Upper Body Mix",                   exercises: ["Incline Press 3×10", "Face Pull 3×15", "Dips 3×12", "Bicep Curl 3×12"] },
    { day: "Friday",    focus: "Full Rest",                        exercises: ["Recovery", "Sleep well", "Eat right"] },
  ],
});

const COACH_COLORS = {
  aria:  { accent: "#00FFFF", label: "Aria" },
  kane:  { accent: "#FF4500", label: "Kane" },
  blaze: { accent: "#FF6B00", label: "Blaze" },
  nova:  { accent: "#A855F7", label: "Nova" },
  zara:  { accent: "#00FF88", label: "Zara" },
};

export default function WorkoutPlanPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedCoach } = useCoach();
  const coach = selectedCoach || "aria";
  const { accent, label } = COACH_COLORS[coach] || COACH_COLORS.aria;

  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeDay, setActiveDay] = useState(null);

  useEffect(() => { loadPlan(); }, []);

  async function loadPlan() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("workout_plans")
        .select("*")
        .eq("user_id", user.id)
        .eq("coach_id", coach)
        .eq("is_active", true)
        .order("generated_at", { ascending: false })
        .limit(1)
        .single();
      if (data) setPlan(data.plan_data);
    } catch (_) {}
    setLoading(false);
  }

  async function generatePlan() {
    setGenerating(true);
    let planData;
    try {
      planData = await generateWorkoutPlan(coach, user);
    } catch (e) {
      planData = FALLBACK_PLAN(coach);
    }

    await supabase
      .from("workout_plans")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("coach_id", coach);

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
      <div style={{ padding: "20px 16px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>←</button>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Weekly Plan</h1>
          <p style={{ margin: 0, fontSize: 12, color: accent }}>Coach {label}</p>
        </div>
      </div>

      <div style={{ padding: "20px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#555" }}>Loading...</div>
        ) : !plan ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏋️</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>No plan yet</h2>
            <p style={{ color: "#666", marginBottom: 32, fontSize: 14 }}>
              Coach {label} will build a personalized weekly plan for you
            </p>
            <button
              onClick={generatePlan}
              disabled={generating}
              style={{
                background: accent, color: "#000", border: "none", borderRadius: 12,
                padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer"
              }}
            >
              {generating ? "Building..." : `Build with ${label} ⚡`}
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button
                onClick={generatePlan}
                disabled={generating}
                style={{
                  background: "transparent", border: `1px solid ${accent}`,
                  color: accent, borderRadius: 8, padding: "8px 16px",
                  fontSize: 12, cursor: "pointer"
                }}
              >
                {generating ? "..." : "🔄 New Plan"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {days.map((d, i) => (
                <div
                  key={i}
                  onClick={() => setActiveDay(activeDay === i ? null : i)}
                  style={{
                    background: "#111", border: `1px solid ${activeDay === i ? accent : "#222"}`,
                    borderRadius: 14, padding: "14px 16px", cursor: "pointer",
                    transition: "border-color 0.2s"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{d.day}</span>
                      <span style={{ color: "#666", fontSize: 12, marginLeft: 8 }}>— {d.focus}</span>
                    </div>
                    <span style={{ color: accent, fontSize: 16 }}>{activeDay === i ? "▲" : "▼"}</span>
                  </div>

                  {activeDay === i && (
                    <div style={{ marginTop: 12, borderTop: "1px solid #222", paddingTop: 12 }}>
                      {d.exercises.map((ex, j) => (
                        <div key={j} style={{
                          padding: "8px 0", borderBottom: j < d.exercises.length - 1 ? "1px solid #1a1a1a" : "none",
                          fontSize: 13, color: "#ccc", display: "flex", alignItems: "center", gap: 8
                        }}>
                          <span style={{ color: accent, fontSize: 10 }}>●</span>
                          {ex}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
