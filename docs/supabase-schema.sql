-- Supabase Database Schema with Row-Level Security (RLS)
-- This file contains the SQL to create tables and RLS policies for the Archivist app

-- Enable Row-Level Security on all tables
-- This ensures that users can only access their own data

-- =====================================================
-- USERS TABLE (extends Supabase auth.users)
-- =====================================================

-- Create a profiles table that extends the auth.users table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DRIVES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.drives (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  total_capacity BIGINT DEFAULT 0,
  used_space BIGINT DEFAULT 0,
  free_space BIGINT DEFAULT 0,
  serial_number TEXT,
  format_type TEXT,
  added_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on drives
ALTER TABLE public.drives ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- FILES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  drive_id UUID REFERENCES public.drives(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT,
  size BIGINT DEFAULT 0,
  created_at_file TIMESTAMP WITH TIME ZONE,
  modified_at_file TIMESTAMP WITH TIME ZONE,
  is_directory BOOLEAN DEFAULT FALSE,
  folder_path TEXT NOT NULL,
  depth INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on files
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- METADATA TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  folder_path TEXT NOT NULL,
  metadata_type TEXT NOT NULL, -- 'tags', 'notes', 'custom_fields', etc.
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, folder_path, metadata_type, key)
);

-- Enable RLS on metadata
ALTER TABLE public.metadata ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Drives policies
CREATE POLICY "Users can view own drives" ON public.drives
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drives" ON public.drives
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drives" ON public.drives
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own drives" ON public.drives
  FOR DELETE USING (auth.uid() = user_id);

-- Files policies
CREATE POLICY "Users can view own files" ON public.files
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own files" ON public.files
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own files" ON public.files
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own files" ON public.files
  FOR DELETE USING (auth.uid() = user_id);

-- Metadata policies
CREATE POLICY "Users can view own metadata" ON public.metadata
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own metadata" ON public.metadata
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own metadata" ON public.metadata
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own metadata" ON public.metadata
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Profiles indexes
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Drives indexes
CREATE INDEX IF NOT EXISTS idx_drives_user_id ON public.drives(user_id);
CREATE INDEX IF NOT EXISTS idx_drives_path ON public.drives(path);

-- Files indexes
CREATE INDEX IF NOT EXISTS idx_files_user_id ON public.files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_drive_id ON public.files(drive_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON public.files(path);
CREATE INDEX IF NOT EXISTS idx_files_parent_path ON public.files(parent_path);
CREATE INDEX IF NOT EXISTS idx_files_folder_path ON public.files(folder_path);

-- Metadata indexes
CREATE INDEX IF NOT EXISTS idx_metadata_user_id ON public.metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_metadata_folder_path ON public.metadata(folder_path);
CREATE INDEX IF NOT EXISTS idx_metadata_type ON public.metadata(metadata_type);

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drives_updated_at BEFORE UPDATE ON public.drives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_metadata_updated_at BEFORE UPDATE ON public.metadata
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get user's total storage usage
CREATE OR REPLACE FUNCTION get_user_storage_usage(user_uuid UUID)
RETURNS TABLE(total_files BIGINT, total_size BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_files,
    COALESCE(SUM(size), 0)::BIGINT as total_size
  FROM public.files 
  WHERE user_id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get drive statistics
CREATE OR REPLACE FUNCTION get_drive_stats(drive_uuid UUID)
RETURNS TABLE(file_count BIGINT, total_size BIGINT, directory_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as file_count,
    COALESCE(SUM(size), 0)::BIGINT as total_size,
    COUNT(*) FILTER (WHERE is_directory = true)::BIGINT as directory_count
  FROM public.files 
  WHERE drive_id = drive_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SUBSCRIPTION SCHEMA EXTENSION
-- =====================================================

-- Add subscription fields to existing profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
ADD COLUMN IF NOT EXISTS access_granted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMP WITH TIME ZONE;

-- Indexes for subscription queries
CREATE INDEX IF NOT EXISTS idx_profiles_plan ON public.profiles(plan);
CREATE INDEX IF NOT EXISTS idx_profiles_access_granted ON public.profiles(access_granted);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);

-- Function to check if user has active subscription
CREATE OR REPLACE FUNCTION is_user_subscribed(user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_uuid 
    AND access_granted = true 
    AND (subscription_ends_at IS NULL OR subscription_ends_at > NOW())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is in trial period
CREATE OR REPLACE FUNCTION is_user_in_trial(user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_uuid 
    AND trial_ends_at IS NOT NULL 
    AND trial_ends_at > NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user subscription status
CREATE OR REPLACE FUNCTION get_user_subscription_status(user_uuid UUID)
RETURNS TABLE(
  plan TEXT,
  access_granted BOOLEAN,
  is_subscribed BOOLEAN,
  is_trialing BOOLEAN,
  trial_days_remaining INTEGER,
  subscription_days_remaining INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.plan,
    p.access_granted,
    CASE 
      WHEN p.access_granted = true AND (p.subscription_ends_at IS NULL OR p.subscription_ends_at > NOW()) 
      THEN true 
      ELSE false 
    END as is_subscribed,
    CASE 
      WHEN p.trial_ends_at IS NOT NULL AND p.trial_ends_at > NOW() 
      THEN true 
      ELSE false 
    END as is_trialing,
    CASE 
      WHEN p.trial_ends_at IS NOT NULL AND p.trial_ends_at > NOW() 
      THEN EXTRACT(DAY FROM (p.trial_ends_at - NOW()))::INTEGER
      ELSE 0 
    END as trial_days_remaining,
    CASE 
      WHEN p.subscription_ends_at IS NOT NULL AND p.subscription_ends_at > NOW() 
      THEN EXTRACT(DAY FROM (p.subscription_ends_at - NOW()))::INTEGER
      ELSE NULL 
    END as subscription_days_remaining
  FROM public.profiles p
  WHERE p.id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments for documentation
COMMENT ON COLUMN public.profiles.plan IS 'Subscription plan: free, monthly, annual, lifetime';
COMMENT ON COLUMN public.profiles.access_granted IS 'Whether user has paid access to premium features';
COMMENT ON COLUMN public.profiles.stripe_customer_id IS 'Stripe customer ID for payment tracking';
COMMENT ON COLUMN public.profiles.subscription_ends_at IS 'When subscription expires (NULL for lifetime)';
COMMENT ON COLUMN public.profiles.trial_ends_at IS 'When free trial expires';
COMMENT ON COLUMN public.profiles.last_payment_date IS 'Date of last successful payment';

COMMENT ON FUNCTION is_user_subscribed(UUID) IS 'Check if user has active paid subscription';
COMMENT ON FUNCTION is_user_in_trial(UUID) IS 'Check if user is in trial period';
COMMENT ON FUNCTION get_user_subscription_status(UUID) IS 'Get comprehensive subscription status for user';

-- =====================================================
-- AUTO-PROFILE CREATION TRIGGER
-- =====================================================

-- Function to automatically create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    email, 
    plan, 
    access_granted, 
    trial_ends_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id, 
    NEW.email, 
    'free', 
    false, 
    (NOW() + INTERVAL '14 days')::timestamp with time zone,
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- EXISTING USER PROFILE CREATION
-- =====================================================

-- Create profile for existing user (run this once)
INSERT INTO public.profiles (
  id, 
  email, 
  plan, 
  access_granted, 
  trial_ends_at,
  created_at,
  updated_at
)
SELECT 
  id, 
  email, 
  'free', 
  false, 
  (NOW() + INTERVAL '14 days')::timestamp with time zone,
  NOW(),
  NOW()
FROM auth.users 
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING; 