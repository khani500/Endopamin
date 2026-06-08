import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FREE_COACH_MESSAGE_LIMIT, isProUser } from '../config/tiers';

export function useTokenGuard() {
  const { user, profile } = useAuth();

  const checkAndConsume = useCallback(async () => {
    if (isProUser(profile)) {
      return { allowed: true, unlimited: true };
    }

    if (!supabase || !user?.id) {
      return { allowed: true };
    }

    const { data, error } = await supabase
      .from('token_usage')
      .select('count')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      import.meta.env.DEV && console.error('Token check error:', error);
      return { allowed: true };
    }

    const currentCount = Number(data?.count) || 0;
    const nextCount = currentCount + 1;

    if (nextCount > FREE_COACH_MESSAGE_LIMIT) {
      return {
        allowed: false,
        used: currentCount,
        limit: FREE_COACH_MESSAGE_LIMIT,
        message: `You've used all ${FREE_COACH_MESSAGE_LIMIT} free coach messages. Upgrade to Pro for unlimited access.`,
      };
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    const { error: upsertError } = await supabase
      .from('token_usage')
      .upsert(
        { user_id: user.id, count: nextCount, month: currentMonth, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );

    if (upsertError) {
      import.meta.env.DEV && console.error('Token upsert error:', upsertError);
      return { allowed: true };
    }

    return {
      allowed: true,
      used: nextCount,
      limit: FREE_COACH_MESSAGE_LIMIT,
      remaining: FREE_COACH_MESSAGE_LIMIT - nextCount,
    };
  }, [user, profile]);

  return { checkAndConsume };
}
