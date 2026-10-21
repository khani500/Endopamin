-- ROLLBACK ONLY. UNEXECUTED. Never run as a sequential follow-on migration.
-- Restores the authenticated read paths used before D3. It intentionally keeps
-- the bucket private and preserves canonical IDs and seeded data.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

GRANT SELECT ON TABLE public.exercise_media TO authenticated;

DROP POLICY IF EXISTS "authenticated read active media" ON public.exercise_media;
CREATE POLICY "authenticated read active media"
  ON public.exercise_media FOR SELECT TO authenticated
  USING (active = true);

DROP POLICY IF EXISTS "authenticated read exercise media objects" ON storage.objects;
CREATE POLICY "authenticated read exercise media objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'exercise-media');

NOTIFY pgrst, 'reload schema';
COMMIT;
