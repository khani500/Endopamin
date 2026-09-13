import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { ProPaywall } from "../components/paywall/ProPaywall";

function logPlanSource(label, planData) {
  const summary = planData?.days?.map((d) => ({
    day: d.day,
    exerciseCount: d.exercises?.length ?? 0,
  }));
  console.log(`[WorkoutPlan] ${label}`, summary);
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

const setupButtonStyle = {
  width: "100%",
  background: "#CCFF00",
  color: "#0A0A0A",
  border: "none",
  borderRadius: 14,
  padding: "16px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  letterSpacing: "0.04em",
};

export default function WorkoutPlanPage() {
  const navigate = useNavigate();
  const { user, profile: authProfile } = useAuth();

  const [plan, setPlan] = useState(null);
  // C110 P0.1 phase 2. The row's primary key, kept beside the plan it belongs
  // to. It comes only from a real workout_plans row and is null whenever there
  // is no such row to name; nothing is derived from the user, the plan JSON or
  // the date. This page fetches its own row rather than reading the id from
  // WorkoutContext, whose separate fetch would go stale if the plan changes.
  const [planRowId, setPlanRowId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [genderMismatch, setGenderMismatch] = useState(false);
  const [activeDay, setActiveDay] = useState(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const coach = profile?.coach_persona || profile?.selected_coach || profile?.current_coach || profile?.coach_id || "aria";
  const { label } = COACH_COLORS[coach] || COACH_COLORS.aria;

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const profileData = await fetchProfile();
    if (profileData) {
      await loadPlan(profileData.gender);
    }
    setLoading(false);
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

  function normalizeGender(gender) {
    return String(gender || "male").toLowerCase();
  }

  function goToPlanSetup() {
    navigate("/profile");
  }

  async function loadPlan(profileGender) {
    const expectedGender = normalizeGender(profileGender);
    setGenderMismatch(false);
    setPlan(null);
    setPlanRowId(null);

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
          setGenderMismatch(true);
          return;
        }

        logPlanSource(
          `Loaded from Supabase (cached plan, id=${data.id}, generated_at=${data.generated_at}, gender=${cachedGender})`,
          data.plan_data,
        );
        setPlan(data.plan_data);
        setPlanRowId(data.id ?? null);
      }
    } catch (_) {}
  }

  const days = plan?.days || [];
  const isPro = authProfile?.is_pro === true;
  const todayName = "Monday"; // TEMP TEST — revert after testing
  const todayIndex = days.findIndex(d => d.day === todayName);
  const todayDay = todayIndex >= 0 ? days[todayIndex] : null;
  const isTodayTraining = todayDay?.type !== 'rest';
  const firstTrainingIndex = days.findIndex(d => d.type !== 'rest');
  const unlockedIndex = (todayIndex !== -1 && days[todayIndex]?.type !== 'rest') ? todayIndex : firstTrainingIndex;

  function isDayLocked(dayIndex, day) {
    return !isPro && dayIndex !== unlockedIndex && day?.type !== 'rest';
  }

  function startWorkoutSession(day, dayIndex) {
    if (isDayLocked(dayIndex, day) || day?.type === 'rest' || !day?.exercises?.length) return;
    // Both call sites already hold the position in `days`, which is
    // plan?.days with no filter and no sort, so this is the canonical
    // position and not a display one. A missing position stays null rather
    // than becoming a number that would point at the wrong day.
    navigate('/workout-session', {
      state: {
        exercises: day.exercises,
        dayName: day.day,
        focus: day.focus,
        planId: planRowId,
        dayIndex: Number.isInteger(dayIndex) && dayIndex >= 0 ? dayIndex : null,
      },
    });
  }

  function renderSetupButton() {
    return (
      <button type="button" onClick={goToPlanSetup} style={setupButtonStyle}>
        Set up your plan
      </button>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", color: "#fff", fontFamily: "sans-serif", paddingBottom: "100px" }}>

      {/* Header */}
      <div style={{ padding: "20px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate('/')} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>←</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Weekly Plan</h1>
            <p style={{ margin: 0, fontSize: 12, color: ACTIVE_DAY_COLOR }}>Coach {label}</p>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
            Loading...
          </div>
        ) : genderMismatch ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏋️</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Plan does not match your profile</h2>
            <p style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>
              This plan was built for a different profile. Regenerate it from Athlete Setup.
            </p>
            {renderSetupButton()}
          </div>
        ) : !plan ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏋️</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>No active plan</h2>
            <p style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>
              Create your weekly plan from Athlete Setup.
            </p>
            {renderSetupButton()}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {isTodayTraining && todayDay?.exercises?.length > 0 && (
              <button
                type="button"
                onClick={() => startWorkoutSession(todayDay, todayIndex)}
                style={{
                  width: "100%",
                  background: "#CCFF00",
                  color: "#0A0A0A",
                  border: "none",
                  borderRadius: 14,
                  padding: "16px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                START TODAY&apos;S WORKOUT
              </button>
            )}
            {days.map((d, i) => {
              const locked = isDayLocked(i, d);
              return (
                <div
                  key={i}
                  onClick={() => (locked ? setShowPaywall(true) : setActiveDay(activeDay === i ? null : i))}
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {!locked && d.type !== "rest" && d.exercises?.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startWorkoutSession(d, i);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: ACTIVE_DAY_COLOR,
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            padding: "4px 0",
                          }}
                        >
                          Start →
                        </button>
                      )}
                      <span style={{ color: ACTIVE_DAY_COLOR, fontSize: 14 }}>{locked ? "🔒" : activeDay === i ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {!locked && activeDay === i && d.exercises?.length > 0 && (
                    <div style={{ marginTop: 12, borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 12px", fontSize: 11, color: "#555", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #1a1a1a" }}>
                        <span>Exercise</span><span>Sets</span><span>Reps</span><span>Rest</span>
                      </div>
                      {d.exercises.map((exercise, j) => (
                        <div key={j} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 12px", padding: "7px 0", borderBottom: j < d.exercises.length - 1 ? "1px solid #1a1a1a" : "none", alignItems: "center" }}>
                          <span style={{ fontSize: 13, color: "#ddd" }}>{exercise.name}</span>
                          <span style={{ fontSize: 12, color: ACTIVE_DAY_COLOR, fontWeight: 600 }}>{exercise.sets}</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{exercise.reps}</span>
                          <span style={{ fontSize: 11, color: "#555" }}>{exercise.rest}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!isPro && (
              <div
                onClick={() => setShowPaywall(true)}
                style={{ background: "#CCFF00", color: "#050505", borderRadius: 14, padding: "15px 16px", textAlign: "center", fontSize: 13, fontWeight: 900, cursor: "pointer" }}
              >
                Upgrade to Pro to unlock your full week
              </div>
            )}
          </div>
        )}
      </div>
      <ProPaywall
        featureName="Full Weekly Plan"
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
      />
    </div>
  );
}
