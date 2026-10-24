-- Purpose: create the singleton emergency controls for vendor content and the Library.
-- Run manually in Supabase SQL Editor.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

CREATE TABLE IF NOT EXISTS public.app_config (
  id smallint PRIMARY KEY CHECK (id = 1),
  vendor_content_enabled boolean NOT NULL DEFAULT true,
  library_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_config (id, vendor_content_enabled, library_enabled)
VALUES (1, true, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read app config" ON public.app_config;
CREATE POLICY "authenticated read app config"
  ON public.app_config
  FOR SELECT
  TO authenticated
  USING (id = 1);

REVOKE ALL ON TABLE public.app_config FROM PUBLIC;
REVOKE ALL ON TABLE public.app_config FROM anon;
REVOKE ALL ON TABLE public.app_config FROM authenticated;
GRANT SELECT ON TABLE public.app_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_config TO service_role;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_config FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_config FROM authenticated;

COMMIT;
