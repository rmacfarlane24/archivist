-- SQL to undo the accidentally created tables and objects
-- Run this in the Supabase SQL Editor to clean up

-- Drop RLS policies first (policies depend on tables)
DROP POLICY IF EXISTS "Service role can manage reports" ON reports;
DROP POLICY IF EXISTS "Users can view reports for their jobs" ON reports;
DROP POLICY IF EXISTS "Service role can manage comments" ON comments;
DROP POLICY IF EXISTS "Users can view comments for their jobs" ON comments;
DROP POLICY IF EXISTS "Users can update their own jobs" ON jobs;
DROP POLICY IF EXISTS "Users can insert their own jobs" ON jobs;
DROP POLICY IF EXISTS "Users can view their own jobs" ON jobs;

-- Drop indexes (indexes depend on tables)
DROP INDEX IF EXISTS idx_reports_job_id;
DROP INDEX IF EXISTS idx_comments_parent_id;
DROP INDEX IF EXISTS idx_comments_job_id;
DROP INDEX IF EXISTS idx_jobs_status;
DROP INDEX IF EXISTS idx_jobs_user_id;

-- Drop tables in reverse dependency order (child tables first, then parent tables)
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;

-- Verify cleanup (optional - run this to check that tables are gone)
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('jobs', 'comments', 'reports');