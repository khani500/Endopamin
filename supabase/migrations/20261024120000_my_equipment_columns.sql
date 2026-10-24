-- UNEXECUTED. Apply by hand in the SQL Editor only on a separate instruction.
-- Reverse: 20261024120001_my_equipment_columns.sql. Never run it as a follow-on.
-- Library only: NULL = not set up; [] = no equipment; tokens = owned equipment.
-- Like 20260922140000_add_profile_equipment_extras.sql, preserve existing
-- table grants and RLS. The client write allowlist excludes these columns;
-- save-profile writes through service_role. No grants or policies change.
-- No default, backfill, data writes, or fingerprint changes.
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
        RAISE EXCEPTION 'Unexpected definition for public.profiles.%', column_name;
      END IF;
    ELSE
      EXECUTE format('ALTER TABLE public.profiles ADD COLUMN %I text[] NULL', column_name);
    END IF;
  END LOOP;
END
$mig$;
COMMIT;
