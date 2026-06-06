import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FREE_COACH_MESSAGE_LIMIT, isProUser } from '../config/tiers';

export function useTokenGuard() {
  const { user, profile } = useAuth();

  const checkAndConsume = useCallback(async () => {
    if (!supabase || !user?.id) return { allowed: true };

    if (isProUser(profile)) return { allowed: true };

    const { data, error } = await supabase
      .from('token_usage')
      .select('count')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      import.meta.env.DEV && console.error('Token check error:', error);
      return { allowed: true };
    }

    const currentCount = data?.count ?? 0;

    if (currentCount >= FREE_COACH_MESSAGE_LIMIT) {
      return {
        allowed: false,
        used: currentCount,
        limit: FREE_COACH_MESSAGE_LIMIT,
        message: `You've used all ${FREE_COACH_MESSAGE_LIMIT} free coach messages. Upgrade to Pro for unlimited access.`,
      };
    }

    await supabase
      .from('token_usage')
      .upsert(
        { user_id: user.id, count: currentCount + 1, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );

    return {
      allowed: true,
      used: currentCount + 1,
      limit: FREE_COACH_MESSAGE_LIMIT,
      remaining: FREE_COACH_MESSAGE_LIMIT - (currentCount + 1),
    };
  }, [user, profile]);

  return { checkAndConsume };
}
