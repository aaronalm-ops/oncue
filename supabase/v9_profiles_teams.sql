-- V9: Profiles — preferred scale, teams, profile completion, public directory
-- Run in Supabase SQL editor after v8_hardening.sql.
--
-- Adds three profile fields and a safe read-only directory view:
--   preferred_key       global transpose preference (NULL = actual, no transpose)
--   teams               multi-select team tags: worship / sound / media
--   profile_completed_at when the one-time "complete your profile" prompt was done
--   public_profiles     view exposing ONLY safe fields to every authenticated user
--                       (so the worship leader's name/initials can be shown)
--
-- Roles (member/worship_leader/admin/master) are unchanged: teams are a
-- SEPARATE, softer axis. They are attribution + view tailoring today, NOT a
-- security boundary — data access still flows through role/RLS. The teams CHECK
-- is written so tightening to a hard boundary later is an additive change.

-- ============================================================
-- 1. New profile columns
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_key text;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS teams text[] NOT NULL DEFAULT '{}';
-- Only these three team tags for now; add values here when new teams appear.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_teams_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_teams_check
  CHECK (teams <@ ARRAY['worship', 'sound', 'media']::text[]);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz;

-- Existing members are all on the worship team today ("Worship = everyone
-- current"). Seed that default so displays aren't blank before they open the
-- completion prompt. profile_completed_at stays NULL so they still get prompted
-- once to set their preferred scale and confirm/adjust teams.
UPDATE profiles SET teams = ARRAY['worship']::text[]
WHERE teams = '{}'::text[] OR teams IS NULL;

-- Self-update of these columns is already allowed by the existing
-- "Users can update own profile" policy; admin edits by "Admins can update all
-- profiles". The enforce_role_rules trigger only fires on role changes, so
-- preferred_key / teams / profile_completed_at writes are unaffected.

-- ============================================================
-- 2. public_profiles — safe directory for every authenticated user
--    Base-table RLS keeps profiles private (own row + admins). This view is
--    security-definer (owned by the migration role) so it can expose a SMALL,
--    non-sensitive column set to everyone — name, instrument, teams — for
--    worship-leader avatars and the "tap to see more" card. Email and role are
--    deliberately NOT exposed here.
-- ============================================================

-- INTENTIONAL: this view is security-definer (the PG15 default, security_invoker
-- OFF). That is REQUIRED — it must bypass the own-row-only RLS on profiles to act
-- as a directory. Do NOT "fix" the advisor's security_definer_view warning by
-- adding security_invoker=true: that would hide every other member's name and
-- break the worship-leader avatars. Safety comes from the tiny column list below
-- (no email, no role) + the authenticated-only grant.
CREATE OR REPLACE VIEW public_profiles AS
  SELECT id, display_name, instrument, teams
  FROM profiles;

REVOKE ALL ON public_profiles FROM public, anon;
GRANT SELECT ON public_profiles TO authenticated;
