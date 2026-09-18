-- Make profiles.onboarding_completed a latch.
-- Once an athlete has finished onboarding, no athlete JWT may undo it.
-- The service role and the dashboard have no auth.uid(), so support and
-- migrations can still reset it deliberately.
--
-- Why: the onboarding coach step wrote onboarding_completed = false on every
-- Continue through the athlete's own JWT. Combined with a week lock that
-- retires the only writer of true, that produced an athlete with saved plans,
-- no way into the app and no logout. The client write is gone as of mobile
-- commit ea9b00a; this trigger stops any future client from reintroducing it.
--
-- EXECUTED MANUALLY on production 2026-09-18 and verified there:
--   true  -> false  by an athlete JWT  RAISEs (P0001)
--   false -> true   by an athlete JWT  succeeds
--   any other column on a completed row succeeds
-- Recorded limitation: a client holding the column grant can still write
-- false -> true, so this makes the flag STICKY, not EARNED. Making
-- /api/save-profile the validating owner and revoking the column from
-- authenticated is a separate coordinated change: a revoke alone would leave
-- no writer at all and no new athlete could ever finish.

create or replace function public.protect_onboarding_completed_latch()
returns trigger
language plpgsql
as $function$
begin
  -- Service role and dashboard admin have no auth.uid() -> allow
  if auth.uid() is null then
    return new;
  end if;

  if old.onboarding_completed is true
     and new.onboarding_completed is distinct from true then
    raise exception
      'onboarding_completed cannot be cleared once it is true';
  end if;

  return new;
end;
$function$;

create trigger trg_protect_onboarding_completed_latch
  before update on public.profiles
  for each row
  execute function public.protect_onboarding_completed_latch();
