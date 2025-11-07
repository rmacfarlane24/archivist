-- Supabase Subscription Schema Migration
-- Add subscription fields to existing profiles table

-- =====================================================
-- EXTEND PROFILES TABLE WITH SUBSCRIPTION FIELDS
-- =====================================================

-- Add subscription fields to existing profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
ADD COLUMN IF NOT EXISTS access_granted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMP WITH TIME ZONE;

-- =====================================================
-- UPDATE EXISTING RLS POLICIES (if needed)
-- =====================================================

-- The existing RLS policies on profiles will automatically apply to new columns
-- Users can only view/update their own subscription data due to existing policies

-- =====================================================
-- INDEXES FOR SUBSCRIPTION QUERIES
-- =====================================================

-- Index for subscription queries
CREATE INDEX IF NOT EXISTS idx_profiles_plan ON public.profiles(plan);
CREATE INDEX IF NOT EXISTS idx_profiles_access_granted ON public.profiles(access_granted);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);

-- =====================================================
-- HELPER FUNCTIONS FOR SUBSCRIPTION MANAGEMENT
-- =====================================================

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

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN public.profiles.plan IS 'Subscription plan: free, monthly, annual, lifetime';
COMMENT ON COLUMN public.profiles.access_granted IS 'Whether user has paid access to premium features';
COMMENT ON COLUMN public.profiles.stripe_customer_id IS 'Stripe customer ID for payment tracking';
COMMENT ON COLUMN public.profiles.subscription_ends_at IS 'When subscription expires (NULL for lifetime)';
COMMENT ON COLUMN public.profiles.trial_ends_at IS 'When free trial expires';
COMMENT ON COLUMN public.profiles.last_payment_date IS 'Date of last successful payment';

COMMENT ON FUNCTION is_user_subscribed(UUID) IS 'Check if user has active paid subscription';
COMMENT ON FUNCTION is_user_in_trial(UUID) IS 'Check if user is in trial period';
COMMENT ON FUNCTION get_user_subscription_status(UUID) IS 'Get comprehensive subscription status for user';
