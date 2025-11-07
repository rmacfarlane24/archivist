#!/usr/bin/env node

/**
 * Test script to debug signup email issues
 * This will help identify why confirmation emails aren't being sent
 */

console.log('🔍 Testing Signup Email Configuration');
console.log('=====================================');

// Test 1: Check environment variables
console.log('\n📋 Test 1: Environment Variables');
console.log('Check if these are set in your .env file:');
console.log('- REACT_APP_SUPABASE_URL');
console.log('- REACT_APP_SUPABASE_ANON_KEY');

// Test 2: Supabase Project Settings
console.log('\n📋 Test 2: Supabase Project Settings');
console.log('Go to your Supabase Dashboard and check:');
console.log('1. Authentication > Settings > Email Auth');
console.log('   - Make sure "Enable email confirmations" is ON');
console.log('   - Check "Confirm email template" is configured');
console.log('2. Authentication > URL Configuration');
console.log('   - Add: app://auth/confirm-signup');
console.log('   - Add: app://auth/reset-password');

// Test 3: Email Provider Configuration
console.log('\n📋 Test 3: Email Provider');
console.log('Check if you have an email provider configured:');
console.log('- Go to Settings > API > Email');
console.log('- Verify SMTP settings or email service is configured');

// Test 4: Test Signup Process
console.log('\n📋 Test 4: Manual Signup Test');
console.log('1. Start your Electron app');
console.log('2. Go to signin page');
console.log('3. Try to create an account with a real email');
console.log('4. Check browser console for any errors');
console.log('5. Check Supabase Dashboard > Authentication > Users');

// Test 5: Check Console Logs
console.log('\n📋 Test 5: Console Debugging');
console.log('Add this to your signin.html after the signup call:');
console.log('console.log("Signup result:", result);');
console.log('console.log("User data:", result.data);');
console.log('console.log("User ID:", result.data?.user?.id);');

// Test 6: Verify Email Template
console.log('\n📋 Test 6: Email Template');
console.log('Check your email template in Supabase:');
console.log('- Go to Authentication > Email Templates');
console.log('- Verify "Confirm signup" template exists');
console.log('- Check template content and variables');

console.log('\n🚨 Common Issues:');
console.log('- Email confirmations disabled in project settings');
console.log('- No email provider configured');
console.log('- Wrong redirect URL in email template');
console.log('- Environment variables not loaded');
console.log('- Supabase project in wrong region/plan');

console.log('\n✅ Next Steps:');
console.log('1. Check Supabase Dashboard settings first');
console.log('2. Verify environment variables are loaded');
console.log('3. Test with a real email address');
console.log('4. Check browser console for errors');
console.log('5. Look for the user in Supabase Users list');
