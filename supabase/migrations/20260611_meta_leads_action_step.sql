-- Add lead_action_step column to meta_leads for the "Lukas Action" CRM workflow
ALTER TABLE meta_leads
  ADD COLUMN IF NOT EXISTS lead_action_step text;
