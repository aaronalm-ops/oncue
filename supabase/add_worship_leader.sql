-- Add worship_leader role and admin panel RLS
-- Run in Supabase SQL editor

-- Extend role check to include worship_leader
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('master', 'admin', 'worship_leader', 'member'));

-- Allow admins/master to read ALL profiles (admin panel)
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (is_privileged());

-- Allow admins/master to update any profile (role changes)
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE USING (is_privileged());

-- Allow admins/master to delete profiles (remove members)
DROP POLICY IF EXISTS "Admins can delete profiles" ON profiles;
CREATE POLICY "Admins can delete profiles" ON profiles
  FOR DELETE USING (is_privileged());

-- NOTE: For member email display in the admin panel, add this env var to Vercel:
-- SUPABASE_SERVICE_ROLE_KEY = (found in Supabase project settings → API → service_role key)
