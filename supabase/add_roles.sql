-- Run this in your Supabase SQL editor after the initial schema

-- Add role column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('master', 'admin', 'member'));

-- Set YOUR account as master (replace with your actual auth.users id)
-- Find it: SELECT id FROM auth.users WHERE email = 'your@email.com';
-- UPDATE profiles SET role = 'master' WHERE id = '<your-user-id>';

-- Helper function: is the current user an admin or master?
CREATE OR REPLACE FUNCTION is_privileged()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('master', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Tighten services RLS: only privileged users can insert or delete
DROP POLICY IF EXISTS "Authenticated users can insert services" ON services;
DROP POLICY IF EXISTS "Authenticated users can update services" ON services;
DROP POLICY IF EXISTS "Authenticated users can delete services" ON services;

CREATE POLICY "Privileged users can insert services" ON services
  FOR INSERT TO authenticated WITH CHECK (is_privileged());

CREATE POLICY "Privileged users can update services" ON services
  FOR UPDATE TO authenticated USING (is_privileged());

CREATE POLICY "Privileged users can delete services" ON services
  FOR DELETE TO authenticated USING (is_privileged());
