import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import ProtectedRoute from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
const Home = lazy(() => import('./pages/Home'));
const Progress = lazy(() => import('./pages/Progress'));
const GymPage = lazy(() => import('./pages/GymPage'));
const CoachPage = lazy(() => import('./pages/CoachPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const ExerciseLibrary = lazy(() => import('./pages/ExerciseLibrary'));
const WorkoutSession = lazy(() => import('./pages/WorkoutSession'));
const WorkoutPlanPage = lazy(() => import('./pages/WorkoutPlanPage'));
const GroupSession = lazy(() => import('./pages/GroupSession'));
const DeskBreakSession = lazy(() => import('./pages/DeskBreakSession'));
import { useAuth, isProfileComplete } from './context/AuthContext';
import { WorkoutProvider } from './context/WorkoutContext';
import { checkUserAbsence, updateLastActive } from './services/absenceDetector';
import { onForegroundMessage } from './lib/firebase';
import { getNotificationSettings, sendNotification, registerForNotifications } from './services/notificationService';
const NutritionLayout = lazy(() => import('./features/nutrition/NutritionLayout'));
const NutritionHub = lazy(() => import('./features/nutrition/pages/NutritionHub'));
const NutritionOverviewPage = lazy(() => import('./features/nutrition/pages/NutritionOverviewPage'));
const NutritionScanPage = lazy(() => import('./features/nutrition/pages/NutritionScanPage'));
const NutritionPlanPage = lazy(() => import('./features/nutrition/pages/NutritionPlanPage'));
const NutritionCoachPage = lazy(() => import('./features/nutrition/pages/NutritionCoachPage'));
const ProSuccessPage = lazy(() => import('./pages/ProSuccessPage'));
const ProCancelPage = lazy(() => import('./pages/ProCancelPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));

function RootRedirect() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#CCFF00]/30 border-t-[#CCFF00]" />
      </div>
    );
  }

  if (!isProfileComplete(profile)) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Home />;
}

function OnboardingRoute() {
  const { profile, loading } = useAuth();
  const initActive = typeof window !== 'undefined'
    && sessionStorage.getItem('onboarding_init_active') === 'true';

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#CCFF00]/30 border-t-[#CCFF00]" />
      </div>
    );
  }

  if (isProfileComplete(profile) && !initActive) {
    return <Navigate to="/" replace />;
  }

  return <OnboardingPage />;
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
            'A 5-minute stretch can help you reset.',
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
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#0A0A0A]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#CCFF00]/30 border-t-[#CCFF00]" /></div>}>
          <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/pro-success" element={<ProSuccessPage />} />
          <Route path="/pro-cancel" element={<ProCancelPage />} />
          <Route path="/" element={<ProtectedRoute><RootRedirect /></ProtectedRoute>} />
          <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/coach" element={<ProtectedRoute><CoachPage /></ProtectedRoute>} />
          <Route path="/log" element={<ProtectedRoute><ErrorBoundary label="Nutrition route"><NutritionLayout /></ErrorBoundary></ProtectedRoute>}>
            <Route index element={<ErrorBoundary label="Nutrition hub"><NutritionHub /></ErrorBoundary>} />
            <Route path="overview" element={<NutritionOverviewPage />} />
            <Route path="scan" element={<NutritionScanPage />} />
            <Route path="plan" element={<NutritionPlanPage />} />
            <Route path="coach" element={<NutritionCoachPage />} />
          </Route>
          <Route path="/nutrition" element={<ProtectedRoute><Navigate to="/log" replace /></ProtectedRoute>} />
          <Route path="/scan" element={<Navigate to="/log/scan" replace />} />
          <Route path="/gym" element={<ProtectedRoute><GymPage /></ProtectedRoute>} />
          <Route path="/gym/desk-break/:breakId" element={<ProtectedRoute><GymPage /></ProtectedRoute>} />
          <Route path="/desk-break/:id" element={<ProtectedRoute><DeskBreakSession /></ProtectedRoute>} />
          <Route path="/exercises" element={<ExerciseLibrary />} />
          <Route path="/exercises/:id" element={<ExerciseLibrary />} />
          <Route path="/workout/:type" element={<ProtectedRoute><WorkoutSession /></ProtectedRoute>} />
          <Route path="/plan/workout" element={<ProtectedRoute><WorkoutSession planMode /></ProtectedRoute>} />
          <Route path="/workout-plan" element={<ProtectedRoute><WorkoutPlanPage /></ProtectedRoute>} />
          <Route path="/plan/nutrition" element={<ProtectedRoute><ErrorBoundary label="Nutrition plan shortcut"><NutritionPlanPage /></ErrorBoundary></ProtectedRoute>} />
          <Route path="/group" element={<GroupSession />} />
          <Route path="/progress" element={<ProtectedRoute><Progress /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/onboarding" element={<ProtectedRoute requireProfile={false}><OnboardingRoute /></ProtectedRoute>} />
          </Routes>
        </Suspense>

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
