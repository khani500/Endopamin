import { Navigate } from 'react-router-dom';
import { isProfileComplete, useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, requireProfile = true }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#CCFF00]/30 border-t-[#CCFF00]" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (requireProfile && !isProfileComplete(profile)) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}
