-- Additional fix for remaining search path warning
-- Drop and recreate the update_subscription_status function

DROP FUNCTION IF EXISTS update_subscription_status(uuid, text, boolean, text, timestamp with time zone, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS update_subscription_status(uuid);

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