-- Incremental Supabase Schema Updates
-- This file adds missing components without recreating existing ones

-- =====================================================
-- TABLES (only create if they don't exist)
-- =====================================================

-- Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Drives table
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

-- Files table
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

-- Metadata table
CREATE TABLE IF NOT EXISTS public.metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  folder_path TEXT NOT NULL,
  metadata_type TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, folder_path, metadata_type, key)
);

-- =====================================================
-- ENABLE RLS (safe to run multiple times)
-- =====================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- POLICIES (use IF NOT EXISTS to avoid conflicts)
-- =====================================================

-- Profiles policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can view own profile') THEN
    CREATE POLICY "Users can view own profile" ON public.profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update own profile') THEN
    CREATE POLICY "Users can update own profile" ON public.profiles
      FOR UPDATE USING (auth.uid() = id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can insert own profile') THEN
    CREATE POLICY "Users can insert own profile" ON public.profiles
      FOR INSERT WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- Drives policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drives' AND policyname = 'Users can view own drives') THEN
    CREATE POLICY "Users can view own drives" ON public.drives
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drives' AND policyname = 'Users can insert own drives') THEN
    CREATE POLICY "Users can insert own drives" ON public.drives
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drives' AND policyname = 'Users can update own drives') THEN
    CREATE POLICY "Users can update own drives" ON public.drives
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drives' AND policyname = 'Users can delete own drives') THEN
    CREATE POLICY "Users can delete own drives" ON public.drives
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Files policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'files' AND policyname = 'Users can view own files') THEN
    CREATE POLICY "Users can view own files" ON public.files
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'files' AND policyname = 'Users can insert own files') THEN
    CREATE POLICY "Users can insert own files" ON public.files
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'files' AND policyname = 'Users can update own files') THEN
    CREATE POLICY "Users can update own files" ON public.files
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'files' AND policyname = 'Users can delete own files') THEN
    CREATE POLICY "Users can delete own files" ON public.files
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Metadata policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metadata' AND policyname = 'Users can view own metadata') THEN
    CREATE POLICY "Users can view own metadata" ON public.metadata
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metadata' AND policyname = 'Users can insert own metadata') THEN
    CREATE POLICY "Users can insert own metadata" ON public.metadata
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metadata' AND policyname = 'Users can update own metadata') THEN
    CREATE POLICY "Users can update own metadata" ON public.metadata
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metadata' AND policyname = 'Users can delete own metadata') THEN
    CREATE POLICY "Users can delete own metadata" ON public.metadata
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- =====================================================
-- INDEXES (only create if they don't exist)
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_drives_user_id ON public.drives(user_id);
CREATE INDEX IF NOT EXISTS idx_drives_path ON public.drives(path);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON public.files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_drive_id ON public.files(drive_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON public.files(path);
CREATE INDEX IF NOT EXISTS idx_files_parent_path ON public.files(parent_path);
CREATE INDEX IF NOT EXISTS idx_files_folder_path ON public.files(folder_path);
CREATE INDEX IF NOT EXISTS idx_metadata_user_id ON public.metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_metadata_folder_path ON public.metadata(folder_path);
CREATE INDEX IF NOT EXISTS idx_metadata_type ON public.metadata(metadata_type);

-- =====================================================
-- FUNCTIONS AND TRIGGERS (safe to recreate)
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS update_drives_updated_at ON public.drives;
DROP TRIGGER IF EXISTS update_files_updated_at ON public.files;
DROP TRIGGER IF EXISTS update_metadata_updated_at ON public.metadata;

-- Create triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drives_updated_at BEFORE UPDATE ON public.drives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_metadata_updated_at BEFORE UPDATE ON public.metadata
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- HELPER FUNCTIONS (safe to recreate)
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