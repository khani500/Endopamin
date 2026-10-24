-- UNEXECUTED. Manual rollback only; never run after the forward migration.
-- Drops both Library equipment columns and any selections stored in them.
-- Existing grants, RLS, other columns, and fingerprint SQL are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

DO $mig$
DECLARE
  column_name text;
  definition record;
BEGIN
  FOREACH column_name IN ARRAY ARRAY['my_equipment_home', 'my_equipment_gym'] LOOP
    SELECT a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef
      INTO definition
      FROM pg_attribute a
     WHERE a.attrelid = 'public.profiles'::regclass
       AND a.attname = column_name AND a.attnum > 0 AND NOT a.attisdropped;
    IF FOUND THEN
      IF definition.atttypid <> 'text[]'::regtype
         OR definition.atttypmod <> -1
         OR definition.attnotnull OR definition.atthasdef THEN
        RAISE EXCEPTION 'Refusing to drop unexpected public.profiles.%', column_name;
      END IF;
      EXECUTE format('ALTER TABLE public.profiles DROP COLUMN %I', column_name);
    END IF;
  END LOOP;
END
$mig$;
COMMIT;
