-- Fix function security vulnerabilities
-- This migration addresses Supabase security warnings by adding secure search paths

-- Function to update updated_at timestamp (FIXED)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's total storage usage (FIXED)
CREATE OR REPLACE FUNCTION get_user_storage_usage(user_uuid UUID)
RETURNS TABLE(total_files BIGINT, total_size BIGINT) 
SECURITY DEFINER 
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_files,
    COALESCE(SUM(size), 0)::BIGINT as total_size
  FROM public.files 
  WHERE user_id = user_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to get drive statistics (FIXED)
CREATE OR REPLACE FUNCTION get_drive_stats(drive_uuid UUID)
RETURNS TABLE(file_count BIGINT, total_size BIGINT, directory_count BIGINT) 
SECURITY DEFINER 
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as file_count,
    COALESCE(SUM(size), 0)::BIGINT as total_size,
    COUNT(*) FILTER (WHERE is_directory = true)::BIGINT as directory_count
  FROM public.files 
  WHERE drive_id = drive_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user has active subscription (FIXED)
CREATE OR REPLACE FUNCTION is_user_subscribed(user_uuid UUID)
RETURNS BOOLEAN 
SECURITY DEFINER 
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_uuid 
    AND access_granted = true 
    AND (subscription_ends_at IS NULL OR subscription_ends_at > NOW())
  );
END;
$$ LANGUAGE plpgsql;

-- Function to check if user is in trial period (FIXED)
CREATE OR REPLACE FUNCTION is_user_in_trial(user_uuid UUID)
RETURNS BOOLEAN 
SECURITY DEFINER 
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_uuid 
    AND trial_ends_at IS NOT NULL 
    AND trial_ends_at > NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get user subscription status (FIXED)
CREATE OR REPLACE FUNCTION get_user_subscription_status(user_uuid UUID)
RETURNS TABLE(
  plan TEXT,
  access_granted BOOLEAN,
  is_subscribed BOOLEAN,
  is_trialing BOOLEAN,
  trial_days_remaining INTEGER,
  subscription_days_remaining INTEGER
) 
SECURITY DEFINER 
SET search_path = ''
AS $$
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
$$ LANGUAGE plpgsql;

-- Function to automatically create profile when user signs up (FIXED)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = ''
AS $$
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
$$ LANGUAGE plpgsql;

-- Enhanced subscription status function (NEW)
-- Drop existing function first due to return type change
DROP FUNCTION IF EXISTS get_enhanced_subscription_status(uuid);

CREATE OR REPLACE FUNCTION get_enhanced_subscription_status(user_uuid UUID)
RETURNS TABLE(
  user_id UUID,
  plan TEXT,
  access_granted BOOLEAN,
  is_subscribed BOOLEAN,
  is_trialing BOOLEAN,
  trial_days_remaining INTEGER,
  subscription_days_remaining INTEGER,
  stripe_customer_id TEXT,
  last_payment_date TIMESTAMP WITH TIME ZONE,
  subscription_ends_at TIMESTAMP WITH TIME ZONE,
  trial_ends_at TIMESTAMP WITH TIME ZONE
) 
SECURITY DEFINER 
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as user_id,
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
    END as subscription_days_remaining,
    p.stripe_customer_id,
    p.last_payment_date,
    p.subscription_ends_at,
    p.trial_ends_at
  FROM public.profiles p
  WHERE p.id = user_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to update subscription status (NEW)
CREATE OR REPLACE FUNCTION update_subscription_status(
  user_uuid UUID,
  new_plan TEXT DEFAULT NULL,
  new_access_granted BOOLEAN DEFAULT NULL,
  new_stripe_customer_id TEXT DEFAULT NULL,
  new_subscription_ends_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  new_trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  new_last_payment_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS BOOLEAN 
SECURITY DEFINER 
SET search_path = ''
AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE public.profiles 
  SET 
    plan = COALESCE(new_plan, plan),
    access_granted = COALESCE(new_access_granted, access_granted),
    stripe_customer_id = COALESCE(new_stripe_customer_id, stripe_customer_id),
    subscription_ends_at = COALESCE(new_subscription_ends_at, subscription_ends_at),
    trial_ends_at = COALESCE(new_trial_ends_at, trial_ends_at),
    last_payment_date = COALESCE(new_last_payment_date, last_payment_date),
    updated_at = NOW()
  WHERE id = user_uuid;
  
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql;