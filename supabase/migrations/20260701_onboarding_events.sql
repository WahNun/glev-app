CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('entered','completed','skipped','back')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own" ON public.onboarding_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own" ON public.onboarding_events FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX ON public.onboarding_events (user_id, step, created_at);
