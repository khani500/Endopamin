import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export const AuthPage = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true });
    }
  }, [user, authLoading, navigate]);

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setMessage('Please fill all fields');
      return;
    }

    if (!supabase) {
      setMessage('Supabase is not configured.');
      return;
    }

    setLoading(true);
    setMessage('');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name.trim() } },
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: data.user.id,
        display_name: name.trim(),
        goal: 'strength_gain',
        experience: 'intermediate',
        gender: 'male',
        job_type: 'mixed',
        days_per_week: 4,
        created_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      if (profileError) {
        console.warn('Profile bootstrap skipped:', profileError.message);
      }
    }

    if (data.session) {
      navigate('/', { replace: true });
      setLoading(false);
      return;
    }

    setMessage('Check your email to confirm your account!');
    setLoading(false);
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      setMessage('Please enter email and password');
      return;
    }

    if (!supabase) {
      setMessage('Supabase is not configured.');
      return;
    }

    setLoading(true);
    setMessage('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    navigate('/', { replace: true });
    setLoading(false);
  };

  const submit = () => {
    if (mode === 'signin') {
      void handleSignIn();
    } else {
      void handleSignUp();
    }
  };

  const content = (
    <div className={`${embedded ? 'py-4' : 'min-h-screen'} flex flex-col items-center justify-center bg-[#0a0a0a] p-6 text-white`}>
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-black tracking-tight">
          ENDO<span className="text-[#CCFF00]">PAMIN</span>
        </h1>
        <p className="mt-1 text-xs tracking-widest text-gray-500">ENDORPHIN · DOPAMINE</p>
        <p className="mt-3 text-sm text-gray-400">Your AI Performance Coach</p>
      </div>

      <div className="mb-6 flex w-full max-w-sm rounded-2xl bg-[#1a1a1a] p-1">
        <button
          type="button"
          onClick={() => {
            setMode('signin');
            setMessage('');
          }}
          className={`flex-1 rounded-xl py-3 text-sm font-bold transition-all ${
            mode === 'signin' ? 'bg-[#CCFF00] text-black' : 'text-gray-400'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('signup');
            setMessage('');
          }}
          className={`flex-1 rounded-xl py-3 text-sm font-bold transition-all ${
            mode === 'signup' ? 'bg-[#CCFF00] text-black' : 'text-gray-400'
          }`}
        >
          Sign Up
        </button>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {!configured && (
          <p className="rounded-xl border border-[#CCFF00]/25 bg-[#CCFF00]/10 p-3 text-center text-xs text-[#CCFF00]">
            Supabase env values are missing.
          </p>
        )}

        {mode === 'signup' && (
          <AuthInput value={name} onChange={setName} placeholder="Your name" autoComplete="name" />
        )}
        <AuthInput value={email} onChange={setEmail} placeholder="Email" type="email" autoComplete="email" />
        <AuthInput
          value={password}
          onChange={setPassword}
          placeholder="Password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />

        {message && <p className="text-center text-sm text-[#CCFF00]">{message}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={loading || !configured}
          className="w-full rounded-xl bg-[#CCFF00] py-4 text-lg font-black text-black disabled:opacity-50"
        >
          {loading ? '...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </div>
    </div>
  );

  return content;
};

function AuthInput({ value, onChange, placeholder, type = 'text', autoComplete }) {
  return (
    <input
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="w-full rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-4 text-white outline-none focus:border-[#CCFF00]"
    />
  );
}

export default AuthPage;
