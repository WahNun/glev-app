-- Telegram-Integration entfernt 2026-06-20
-- agent_messages war ausschließlich Message-Bus für den Telegram-Bot-Agent
-- (scripts/notify-telegram, ask-telegram, check-inbox, inbox-daemon).
-- Alle 26 Rows sind historische Dev-Notifications — kein User-Facing-Daten.
DROP TABLE IF EXISTS public.agent_messages CASCADE;
