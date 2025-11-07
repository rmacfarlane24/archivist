-- Phase 1: Enhanced Subscription Management Schema
-- Adds additional columns for proper subscription status tracking and offline bypass prevention
-- This migration is safe to run on existing databases

-- =====================================================
-- ADD NEW COLUMNS TO PROFILES TABLE
-- =====================================================

-- Add new subscription status tracking columns
-- These columns enable proper handling of payment failures and offline bypass prevention
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS payment_failed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_payment_failure TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- =====================================================
-- UPDATE EXISTING COLUMNS (safe to run multiple times)
-- =====================================================

-- Ensure subscription_ends_at is properly named (rename if needed)
-- Note: We already have this column from existing schema, so this is just for consistency
DO $$
BEGIN
  -- Check if we need to rename subscription_ends_at column
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' 
             AND column_name = 'subscription_ends_at' 
             AND table_schema = 'public') THEN
    -- Column already exists with correct name
    NULL;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'profiles' 
                AND column_name = 'subscription_end_date' 
                AND table_schema = 'public') THEN
    -- Rename if it exists with different name
    ALTER TABLE public.profiles RENAME COLUMN subscription_end_date TO subscription_ends_at;
  END IF;
END $$;

-- =====================================================
-- CREATE INDEXES FOR NEW COLUMNS
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status ON public.profiles(subscription_status);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_ends_at ON public.profiles(subscription_ends_at);
CREATE INDEX IF NOT EXISTS idx_profiles_grace_period_end ON public.profiles(grace_period_end);
CREATE INDEX IF NOT EXISTS idx_profiles_payment_failed ON public.profiles(payment_failed);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription_id ON public.profiles(stripe_subscription_id);

-- =====================================================
-- UPDATE EXISTING DATA TO USE NEW STATUS SYSTEM
-- =====================================================

-- Set subscription_status based on existing data
UPDATE public.profiles 
SET subscription_status = CASE 
  WHEN access_granted = true AND plan != 'free' THEN 'active'
  WHEN trial_ends_at IS NOT NULL AND trial_ends_at > NOW() THEN 'trial'
  WHEN trial_ends_at IS NOT NULL AND trial_ends_at <= NOW() THEN 'expired'
  WHEN access_granted = false AND plan != 'free' THEN 'cancelled'
  ELSE 'trial'
END
WHERE subscription_status = 'trial'; -- Only update records that haven't been updated yet

-- =====================================================
-- ENHANCED HELPER FUNCTIONS
-- =====================================================

-- Function to check comprehensive subscription status
CREATE OR REPLACE FUNCTION get_enhanced_subscription_status(user_uuid UUID)
RETURNS TABLE(
  plan TEXT,
  subscription_status TEXT,
  access_granted BOOLEAN,
  is_subscribed BOOLEAN,
  is_trialing BOOLEAN,
  is_expired BOOLEAN,
  is_overdue BOOLEAN,
  requires_reauth BOOLEAN,
  trial_days_remaining INTEGER,
  subscription_days_remaining INTEGER,
  grace_period_days_remaining INTEGER,
  subscription_ends_at TIMESTAMP WITH TIME ZONE,
  trial_ends_at TIMESTAMP WITH TIME ZONE,
  grace_period_end TIMESTAMP WITH TIME ZONE,
  payment_failed BOOLEAN,
  last_payment_date TIMESTAMP WITH TIME ZONE,
  last_payment_failure TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.plan,
    p.subscription_status,
    p.access_granted,
    -- is_subscribed: active paid subscription
    CASE 
      WHEN p.access_granted = true 
           AND p.subscription_status = 'active' 
           AND (p.subscription_ends_at IS NULL OR p.subscription_ends_at > NOW()) 
      THEN true 
      ELSE false 
    END as is_subscribed,
    -- is_trialing: in trial period
    CASE 
      WHEN p.subscription_status = 'trial' 
           AND p.trial_ends_at IS NOT NULL 
           AND p.trial_ends_at > NOW() 
      THEN true 
      ELSE false 
    END as is_trialing,
    -- is_expired: trial has ended
    CASE 
      WHEN p.subscription_status = 'expired' 
           OR (p.subscription_status = 'trial' AND p.trial_ends_at IS NOT NULL AND p.trial_ends_at <= NOW())
      THEN true 
      ELSE false 
    END as is_expired,
    -- is_overdue: paid subscription but payment failed
    CASE 
      WHEN p.subscription_status = 'overdue' 
           OR (p.payment_failed = true AND p.plan != 'free')
      THEN true 
      ELSE false 
    END as is_overdue,
    -- requires_reauth: subscription or trial has ended
    CASE 
      WHEN (p.subscription_ends_at IS NOT NULL AND p.subscription_ends_at <= NOW())
           OR (p.trial_ends_at IS NOT NULL AND p.trial_ends_at <= NOW())
           OR (p.grace_period_end IS NOT NULL AND p.grace_period_end <= NOW())
      THEN true 
      ELSE false 
    END as requires_reauth,
    -- trial_days_remaining
    CASE 
      WHEN p.trial_ends_at IS NOT NULL AND p.trial_ends_at > NOW() 
      THEN EXTRACT(DAY FROM (p.trial_ends_at - NOW()))::INTEGER
      ELSE 0 
    END as trial_days_remaining,
    -- subscription_days_remaining
    CASE 
      WHEN p.subscription_ends_at IS NOT NULL AND p.subscription_ends_at > NOW() 
      THEN EXTRACT(DAY FROM (p.subscription_ends_at - NOW()))::INTEGER
      ELSE NULL 
    END as subscription_days_remaining,
    -- grace_period_days_remaining
    CASE 
      WHEN p.grace_period_end IS NOT NULL AND p.grace_period_end > NOW() 
      THEN EXTRACT(DAY FROM (p.grace_period_end - NOW()))::INTEGER
      ELSE 0 
    END as grace_period_days_remaining,
    -- Raw timestamp fields
    p.subscription_ends_at,
    p.trial_ends_at,
    p.grace_period_end,
    p.payment_failed,
    p.last_payment_date,
    p.last_payment_failure
  FROM public.profiles p
  WHERE p.id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update subscription status (used by webhooks)
CREATE OR REPLACE FUNCTION update_subscription_status(
  user_uuid UUID,
  new_plan TEXT DEFAULT NULL,
  new_status TEXT DEFAULT NULL,
  grant_access BOOLEAN DEFAULT NULL,
  new_subscription_end TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  clear_trial BOOLEAN DEFAULT false,
  payment_success BOOLEAN DEFAULT NULL,
  stripe_customer TEXT DEFAULT NULL,
  stripe_subscription TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  updated_profile public.profiles
) AS $$
DECLARE
  profile_record public.profiles;
  update_data jsonb := '{}'::jsonb;
BEGIN
  -- Build update data dynamically
  IF new_plan IS NOT NULL THEN
    update_data := update_data || jsonb_build_object('plan', new_plan);
  END IF;
  
  IF new_status IS NOT NULL THEN
    update_data := update_data || jsonb_build_object('subscription_status', new_status);
  END IF;
  
  IF grant_access IS NOT NULL THEN
    update_data := update_data || jsonb_build_object('access_granted', grant_access);
  END IF;
  
  IF new_subscription_end IS NOT NULL THEN
    update_data := update_data || jsonb_build_object('subscription_ends_at', new_subscription_end);
  END IF;
  
  IF clear_trial = true THEN
    update_data := update_data || jsonb_build_object('trial_ends_at', NULL);
  END IF;
  
  IF payment_success IS NOT NULL THEN
    IF payment_success = true THEN
      update_data := update_data || jsonb_build_object(
        'payment_failed', false,
        'last_payment_date', NOW(),
        'last_payment_failure', NULL,
        'grace_period_end', NULL
      );
    ELSE
      update_data := update_data || jsonb_build_object(
        'payment_failed', true,
        'last_payment_failure', NOW(),
        'access_granted', false,
        'subscription_status', 'overdue'
      );
    END IF;
  END IF;
  
  IF stripe_customer IS NOT NULL THEN
    update_data := update_data || jsonb_build_object('stripe_customer_id', stripe_customer);
  END IF;
  
  IF stripe_subscription IS NOT NULL THEN
    update_data := update_data || jsonb_build_object('stripe_subscription_id', stripe_subscription);
  END IF;
  
  -- Always update the updated_at timestamp
  update_data := update_data || jsonb_build_object('updated_at', NOW());
  
  -- Perform the update
  UPDATE public.profiles 
  SET 
    plan = COALESCE((update_data->>'plan')::TEXT, plan),
    subscription_status = COALESCE((update_data->>'subscription_status')::TEXT, subscription_status),
    access_granted = COALESCE((update_data->>'access_granted')::BOOLEAN, access_granted),
    subscription_ends_at = CASE 
      WHEN update_data ? 'subscription_ends_at' THEN (update_data->>'subscription_ends_at')::TIMESTAMP WITH TIME ZONE
      ELSE subscription_ends_at 
    END,
    trial_ends_at = CASE 
      WHEN update_data ? 'trial_ends_at' THEN (update_data->>'trial_ends_at')::TIMESTAMP WITH TIME ZONE
      ELSE trial_ends_at 
    END,
    payment_failed = COALESCE((update_data->>'payment_failed')::BOOLEAN, payment_failed),
    last_payment_date = CASE 
      WHEN update_data ? 'last_payment_date' THEN (update_data->>'last_payment_date')::TIMESTAMP WITH TIME ZONE
      ELSE last_payment_date 
    END,
    last_payment_failure = CASE 
      WHEN update_data ? 'last_payment_failure' THEN (update_data->>'last_payment_failure')::TIMESTAMP WITH TIME ZONE
      ELSE last_payment_failure 
    END,
    grace_period_end = CASE 
      WHEN update_data ? 'grace_period_end' THEN (update_data->>'grace_period_end')::TIMESTAMP WITH TIME ZONE
      ELSE grace_period_end 
    END,
    stripe_customer_id = COALESCE((update_data->>'stripe_customer_id')::TEXT, stripe_customer_id),
    stripe_subscription_id = COALESCE((update_data->>'stripe_subscription_id')::TEXT, stripe_subscription_id),
    updated_at = NOW()
  WHERE id = user_uuid
  RETURNING * INTO profile_record;
  
  IF FOUND THEN
    RETURN QUERY SELECT true, 'Subscription updated successfully'::TEXT, profile_record;
  ELSE
    RETURN QUERY SELECT false, 'User not found'::TEXT, NULL::public.profiles;
  END IF;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN public.profiles.subscription_status IS 'Current subscription status: trial, active, expired, overdue, cancelled';
COMMENT ON COLUMN public.profiles.grace_period_end IS 'End of grace period for payment failures (optional)';
COMMENT ON COLUMN public.profiles.payment_failed IS 'Whether the last payment attempt failed';
COMMENT ON COLUMN public.profiles.last_payment_failure IS 'Timestamp of last payment failure';
COMMENT ON COLUMN public.profiles.stripe_subscription_id IS 'Stripe subscription ID for recurring subscriptions';

COMMENT ON FUNCTION get_enhanced_subscription_status(UUID) IS 'Get comprehensive subscription status including expiry and payment status';
COMMENT ON FUNCTION update_subscription_status(UUID, TEXT, TEXT, BOOLEAN, TIMESTAMP WITH TIME ZONE, BOOLEAN, BOOLEAN, TEXT, TEXT) IS 'Update subscription status with flexible parameters for webhook handlers';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Log successful migration
DO $$
BEGIN
  RAISE NOTICE 'Enhanced subscription management schema migration completed successfully';
  RAISE NOTICE 'New columns added: subscription_status, grace_period_end, payment_failed, last_payment_failure, stripe_subscription_id';
  RAISE NOTICE 'New functions created: get_enhanced_subscription_status, update_subscription_status';
  RAISE NOTICE 'All existing data has been preserved and updated with new status values';
END $$;