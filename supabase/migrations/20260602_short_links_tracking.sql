-- Click-Tracking für Short-Links: welcher Kanal (sms/email) wurde zuerst geklickt.
ALTER TABLE public.short_links
  ADD COLUMN IF NOT EXISTS source     TEXT,        -- 'sms' | 'email' | NULL
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ; -- first click timestamp
