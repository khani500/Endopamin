import { useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export default function AuthPage({ embedded = false }) {
  const [mode, setMode] = useState('signup');
  const [view, setView] = useState('form');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const configured = isSupabaseConfigured();

  const handleEmailAuth = async event => {
    event.preventDefault();
    if (!supabase) {
      setMessage('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName.trim() || email.split('@')[0] },
          },
        });

        if (error) throw error;

        if (data.user) {
          const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            created_at: new Date().toISOString(),
          });

          if (profileError && profileError.code !== '23505') throw profileError;
        }

        if (data.user && !data.session) {
          setView('check-email');
          return;
        }

        setMessage('Account created.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      if (error?.code === '23505') {
        setMessage('Account created. Profile already exists.');
      } else {
        setMessage(error instanceof Error ? error.message : 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!supabase) {
      setMessage('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google sign in failed.');
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    if (!supabase || !email) return;
    setLoading(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      setMessage('Confirmation email sent again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not resend email.');
    } finally {
      setLoading(false);
    }
  };

  if (view === 'check-email') {
    const checkEmailContent = (
      <section className="w-full max-w-[390px] rounded-3xl border border-white/10 bg-[#141416] p-8 text-center shadow-2xl shadow-black/50">
        <div className="mb-4 text-6xl">📧</div>
        <h2 className="mb-2 text-xl font-bold text-white">Check your email</h2>
        <p className="mb-6 text-sm text-gray-400">We sent a confirmation link to {email}</p>
        <p className="text-xs text-gray-500">Click the link in the email to activate your account</p>
        <button
          type="button"
          onClick={() => void resendConfirmation()}
          disabled={loading}
          className="mt-4 text-sm text-[#CCFF00] disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Resend email'}
        </button>
        {message && <p className="mt-4 text-xs font-bold text-white/55">{message}</p>}
      </section>
    );

    if (embedded) return checkEmailContent;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-5 py-10 text-white">
        {checkEmailContent}
      </main>
    );
  }

  const content = (
    <section className="w-full max-w-[390px] rounded-3xl border border-white/10 bg-[#141416] p-5 shadow-2xl shadow-black/50">
        <div className="mb-7 text-center">
          <h1 className="text-3xl font-black tracking-[-0.05em]">
            DOPA<span className="text-[#CCFF00]">PEAK</span>
          </h1>
          <p className="mt-2 text-sm text-white/45">Sign in to sync your coach, profile, and progress.</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-2xl bg-black/40 p-1">
          {[
            ['signup', 'Sign Up'],
            ['signin', 'Sign In'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id);
                setMessage('');
              }}
              className={`rounded-xl py-3 text-sm font-black ${
                mode === id ? 'bg-[#CCFF00] text-black' : 'text-white/45'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!configured && (
          <div className="mb-4 rounded-2xl border border-[#CCFF00]/25 bg-[#CCFF00]/10 p-3 text-xs leading-5 text-[#CCFF00]">
            Supabase env values are missing. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-3">
          {mode === 'signup' && (
            <AuthInput
              value={displayName}
              onChange={setDisplayName}
              placeholder="Display name"
              autoComplete="name"
            />
          )}
          <AuthInput value={email} onChange={setEmail} placeholder="Email" type="email" autoComplete="email" />
          <AuthInput
            value={password}
            onChange={setPassword}
            placeholder="Password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />

          <button
            type="submit"
            disabled={loading || !configured}
            className="w-full rounded-2xl bg-[#CCFF00] px-4 py-4 text-sm font-black text-black disabled:opacity-50"
          >
            {loading ? 'Please wait...' : mode === 'signup' ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading || !configured}
          className="mt-3 w-full rounded-2xl bg-[#CCFF00] px-4 py-4 text-sm font-black text-black disabled:opacity-50"
        >
          Continue with Google
        </button>

        {message && <p className="mt-4 text-center text-xs font-bold text-white/55">{message}</p>}
    </section>
  );

  if (embedded) {
    return content;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-5 py-10 text-white">
      {content}
    </main>
  );
}

function AuthInput({ value, onChange, placeholder, type = 'text', autoComplete }) {
  return (
    <input
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      type={type}
      autoComplete={autoComplete}
      required
      className="w-full rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
    />
  );
}
