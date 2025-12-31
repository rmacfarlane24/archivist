-- Diagnostic query to check current function status
-- Run this in Supabase SQL Editor to see what's happening

-- 1. Check all versions of update_subscription_status function
SELECT 
    routine_name,
    specific_name,
    routine_type,
    security_type,
    sql_data_access,
    routine_definition
FROM information_schema.routines 
WHERE routine_name = 'update_subscription_status' 
AND routine_schema = 'public';

-- 2. Check function parameters
SELECT 
    specific_name,
    parameter_name,
    data_type,
    parameter_mode,
    ordinal_position
FROM information_schema.parameters 
WHERE specific_schema = 'public' 
AND specific_name IN (
    SELECT specific_name 
    FROM information_schema.routines 
    WHERE routine_name = 'update_subscription_status'
);

-- 3. Check search_path setting for functions
SELECT 
    proname as function_name,
    prosrc as function_body,
    proconfig as function_config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND proname = 'update_subscription_status';