import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { isProUser } from '../config/tiers';

// Free users: 30 messages/month. Pro users: unlimited.
const FREE_MONTHLY_LIMIT = 30;

export function useTokenGuard() {
  const { user, profile } = useAuth();

  const checkAndConsume = useCallback(async () => {
    if (!supabase || !user?.id) return { allowed: true };

    // Pro users always allowed
    if (isProUser(profile)) return { allowed: true };

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('token_usage')
      .select('count')
      .eq('user_id', user.id)
      .eq('month', monthKey)
      .maybeSingle();

    if (error) {
      import.meta.env.DEV && console.error('Token check error:', error);
      return { allowed: true }; // fail open so users aren't blocked by DB errors
    }

    const currentCount = data?.count ?? 0;

    if (currentCount >= FREE_MONTHLY_LIMIT) {
      return {
        allowed: false,
        used: currentCount,
        limit: FREE_MONTHLY_LIMIT,
        message: `You've used all ${FREE_MONTHLY_LIMIT} free messages this month. Upgrade to Pro for unlimited access.`,
      };
    }

    // Upsert usage count
    await supabase
      .from('token_usage')
      .upsert(
        { user_id: user.id, month: monthKey, count: currentCount + 1 },
        { onConflict: 'user_id,month' },
      );

    return {
      allowed: true,
      used: currentCount + 1,
      limit: FREE_MONTHLY_LIMIT,
      remaining: FREE_MONTHLY_LIMIT - (currentCount + 1),
    };
  }, [user, profile]);

  return { checkAndConsume };
}