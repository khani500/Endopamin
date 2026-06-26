import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isProUser } from '../config/tiers';
import { ProPaywall } from '../components/paywall/ProPaywall';

export default function UpgradePage() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth() || {};

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080808]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#CCFF00]/30 border-t-[#CCFF00]" />
      </div>
    );
  }

  if (user && isProUser(profile)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#080808] px-6 text-center text-white">
        <h1 className="m-0 text-2xl font-black text-[#CCFF00]">You already have Pro!</h1>
        <Link
          to="/"
          className="mt-8 inline-flex rounded-2xl bg-[#CCFF00] px-6 py-3 text-sm font-black text-black no-underline"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  const isLoggedIn = Boolean(user);

  return (
    <div className="min-h-screen bg-[#080808]">
      {!isLoggedIn && (
        <p className="fixed left-1/2 top-4 z-[95] w-[min(calc(100vw-32px),390px)] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#111] px-4 py-3 text-center text-sm leading-5 text-white/70">
          Sign up or log in to complete your purchase.{' '}
          <Link to="/auth" className="font-bold text-[#CCFF00] no-underline">Sign in</Link>
        </p>
      )}
      <ProPaywall
        featureName="Endopamin Pro"
        isVisible
        onClose={() => navigate(isLoggedIn ? '/' : '/auth')}
      />
    </div>
  );
}
