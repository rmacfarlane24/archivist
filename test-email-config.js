#!/usr/bin/env node

/**
 * Detailed email configuration test for Supabase
 * This checks the specific settings that often cause email delivery issues
 */

console.log('🔍 Detailed Email Configuration Check');
console.log('=====================================');

console.log('\n📧 Check These Specific Settings in Supabase Dashboard:');

console.log('\n1. EMAIL PROVIDER SETUP:');
console.log('   Go to: Settings > API > Email');
console.log('   - Is there an email provider configured?');
console.log('   - If using SMTP, are the credentials correct?');
console.log('   - If using a service (SendGrid, etc.), is the API key valid?');

console.log('\n2. EMAIL TEMPLATE CONTENT:');
console.log('   Go to: Authentication > Email Templates > Confirm signup');
console.log('   - Does the template exist?');
console.log('   - Check if the redirect URL in the template matches:');
console.log('     app://auth/confirm-signup');
console.log('   - Verify the template has the correct variables');

console.log('\n3. PROJECT PLAN LIMITS:');
console.log('   Go to: Settings > Billing');
console.log('   - What plan are you on?');
console.log('   - Free tier has limited email sending');
console.log('   - Check if you\'ve hit email limits');

console.log('\n4. REGION SETTINGS:');
console.log('   Go to: Settings > General');
console.log('   - What region is your project in?');
console.log('   - Some regions have different email delivery');

console.log('\n5. SPAM/EMAIL DELIVERY:');
console.log('   - Check your spam/junk folder');
console.log('   - Check if your email provider is blocking Supabase');
console.log('   - Try with a different email address (Gmail, Outlook, etc.)');

console.log('\n6. TEST WITH CONSOLE LOGS:');
console.log('   - The debugging I added should show:');
console.log('     * If signup succeeded');
console.log('     * User ID created');
console.log('     * Any error messages');
console.log('   - Check if result.data.user.id exists');

console.log('\n🚨 MOST COMMON ISSUES:');
console.log('1. No email provider configured in Settings > API > Email');
console.log('2. Wrong redirect URL in email template');
console.log('3. Free tier email limits reached');
console.log('4. Email going to spam folder');
console.log('5. Email provider blocking Supabase');

console.log('\n✅ IMMEDIATE ACTIONS:');
console.log('1. Check Settings > API > Email for provider configuration');
console.log('2. Verify email template redirect URL');
console.log('3. Check spam folder');
console.log('4. Try with a different email address');
console.log('5. Look at console logs during signup');

console.log('\n🔧 IF STILL NOT WORKING:');
console.log('1. Check Supabase logs in Dashboard > Logs');
console.log('2. Verify your project is not in maintenance mode');
console.log('3. Contact Supabase support if on paid plan');
console.log('4. Consider upgrading from free tier if applicable');
