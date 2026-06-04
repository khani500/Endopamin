import { useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import ProtectedRoute from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import Home from './pages/Home';
import Progress from './pages/Progress';
import GymPage from './pages/GymPage';
import CoachPage from './pages/CoachPage';
import ProfilePage from './pages/ProfilePage';
import AuthPage from './pages/AuthPage';
import OnboardingPage from './pages/OnboardingPage';
import ExerciseLibrary from './pages/ExerciseLibrary';
import WorkoutSession from './pages/WorkoutSession';
import WorkoutPlanPage from './pages/WorkoutPlanPage';
import GroupSession from './pages/GroupSession';
import DeskBreakSession from './pages/DeskBreakSession';
import { useAuth } from './context/AuthContext';
import { WorkoutProvider } from './context/WorkoutContext';
import { checkUserAbsence, updateLastActive } from './services/absenceDetector';
import { onForegroundMessage } from './lib/firebase';
import { getNotificationSettings, sendNotification, registerForNotifications } from './services/notificationService';
import NutritionLayout from './features/nutrition/NutritionLayout';
import NutritionHub from './features/nutrition/pages/NutritionHub';
import NutritionOverviewPage from './features/nutrition/pages/NutritionOverviewPage';
import NutritionScanPage from './features/nutrition/pages/NutritionScanPage';
import NutritionPlanPage from './features/nutrition/pages/NutritionPlanPage';
import NutritionCoachPage from './features/nutrition/pages/NutritionCoachPage';

function RootRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return null;

  const localDone = localStorage.getItem('onboarding_done') === 'true';
  const profileDone = profile?.onboarding_completed === true;
  const hasProfile = Boolean(profile?.goal && profile?.experience);
  const hasBodyData = Boolean(profile?.height || profile?.weight || profile?.age);

  if (!hasBodyData && !profileDone) {
    return <Navigate to="/onboarding" replace />;
  }

  if (!profileDone && !localDone && !hasProfile) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Home />;
}

function App() {
  const { user, profile } = useAuth();
  const [toast, setToast] = useState(null);
  const absenceCheckKeyRef = useRef('');

  const showInAppNotification = notification => {
    setToast(notification);
    window.setTimeout(() => setToast(null), 6000);
  };

  useEffect(() => {
    let unsubscribe = () => {};

    onForegroundMessage(payload => {
      const notification = payload.notification || {};
      showInAppNotification({
        title: notification.title || 'ENDOPAMIN',
        body: notification.body || 'You have a new update.',
        type: payload.data?.type || 'fcm_foreground',
      });
    }).then(cleanup => {
      unsubscribe = cleanup;
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id || !profile) return;

    registerForNotifications(user.id).catch(() => {});

    const checkKey = `${user.id}:${profile.last_active || 'new'}`;
    if (absenceCheckKeyRef.current === checkKey) return;
    absenceCheckKeyRef.current = checkKey;

    const runAbsenceCheck = async () => {
      const notification = await checkUserAbsence(user.id, profile);
      await updateLastActive(user.id);
      if (notification) {
        window.setTimeout(() => showInAppNotification(notification), 0);
      }
    };

    void runAbsenceCheck();
  }, [user?.id, profile]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const isDeskWorker = !profile?.job_type || profile?.job_type === 'desk_worker' || profile?.job_type === 'mixed';
    if (!isDeskWorker) return undefined;
    let intervalId;
    let cancelled = false;

    const startDeskBreakTimer = async () => {
      const settings = await getNotificationSettings(user.id);
      if (cancelled || !settings?.desk_breaks) return;

      const intervalMinutes = settings.desk_break_interval || 60;
      intervalId = window.setInterval(() => {
        const hour = new Date().getHours();
        if (hour >= 9 && hour <= 18) {
          sendNotification(
            '🪑 Time for a desk break!',
            'A 5-minute stretch will boost your focus by 20%.',
            { type: 'desk_break' },
          );
        }
      }, intervalMinutes * 60 * 1000);
    };

    void startDeskBreakTimer();
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user?.id, profile?.job_type]);

  return (
    <WorkoutProvider>
    <Router>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#0A0A0A] pb-16">
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/" element={<ProtectedRoute><RootRedirect /></ProtectedRoute>} />
          <Route path="/coach" element={<ProtectedRoute><CoachPage /></ProtectedRoute>} />
          <Route path="/log" element={<ProtectedRoute><ErrorBoundary label="Nutrition route"><NutritionLayout /></ErrorBoundary></ProtectedRoute>}>
            <Route index element={<ErrorBoundary label="Nutrition hub"><NutritionHub /></ErrorBoundary>} />
            <Route path="overview" element={<NutritionOverviewPage />} />
            <Route path="scan" element={<NutritionScanPage />} />
            <Route path="plan" element={<NutritionPlanPage />} />
            <Route path="coach" element={<NutritionCoachPage />} />
          </Route>
          <Route path="/nutrition" element={<Navigate to="/log" replace />} />
          <Route path="/scan" element={<Navigate to="/log/scan" replace />} />
          <Route path="/gym" element={<ProtectedRoute><GymPage /></ProtectedRoute>} />
          <Route path="/gym/desk-break/:breakId" element={<GymPage />} />
          <Route path="/desk-break/:id" element={<DeskBreakSession />} />
          <Route path="/exercises" element={<ExerciseLibrary />} />
          <Route path="/exercises/:id" element={<ExerciseLibrary />} />
          <Route path="/workout/:type" element={<WorkoutSession />} />
          <Route path="/plan/workout" element={<WorkoutSession planMode />} />
          <Route path="/workout-plan" element={<WorkoutPlanPage />} />
          <Route path="/plan/nutrition" element={<ErrorBoundary label="Nutrition plan shortcut"><NutritionHub /></ErrorBoundary>} />
          <Route path="/group" element={<GroupSession />} />
          <Route path="/progress" element={<ProtectedRoute><Progress /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Routes>

        {toast && (
          <div className="fixed left-1/2 top-4 z-[60] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-[#CCFF00]/30 bg-[#111] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">{toast.title}</p>
                <p className="mt-1 text-xs leading-5 text-white/65">{toast.body}</p>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="rounded-full bg-white/10 px-2 py-1 text-xs font-bold text-white/60"
                aria-label="Dismiss notification"
              >
                X
              </button>
            </div>
          </div>
        )}

        <BottomNav />
      </div>
    </Router>
    </WorkoutProvider>
  );
}

export default App;
