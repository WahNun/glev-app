-- Add is_synthetic_test flag to meta_leads so admin-injected test leads
-- can be distinguished from real Meta Ads leads in exports and stats.
-- Note: is_test (boolean) already exists for Meta's own test_lead flag.

ALTER TABLE public.meta_leads
  ADD COLUMN IF NOT EXISTS is_synthetic_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.meta_leads.is_synthetic_test IS
  'TRUE for leads injected via the admin Test-Lead-Injector tool — never from real Meta Ads webhooks. Use to exclude from CPL/reach stats.';
