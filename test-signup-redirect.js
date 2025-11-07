#!/usr/bin/env node

/**
 * Test script to verify signup redirect handling
 * Run this after starting your Electron app to test the app:// protocol
 */

console.log('🧪 Testing Signup Redirect Handling');
console.log('=====================================');

// Test the app:// protocol URLs that should work
const testUrls = [
  'app://auth/confirm-signup#access_token=test_token&refresh_token=test_refresh',
  'app://auth/reset-password#access_token=test_token&refresh_token=test_refresh'
];

console.log('\n📋 Test URLs to verify:');
testUrls.forEach((url, index) => {
  console.log(`${index + 1}. ${url}`);
});

console.log('\n🔧 To test these URLs:');
console.log('1. Make sure your Electron app is running');
console.log('2. Copy one of the URLs above');
console.log('3. Paste it in your browser address bar');
console.log('4. Press Enter - it should open your Electron app');
console.log('5. Check the console for "Received app:// URL:" messages');

console.log('\n⚠️  Important:');
console.log('- Your Supabase project must have these redirect URLs configured:');
console.log('  - app://auth/confirm-signup');
console.log('  - app://auth/reset-password');
console.log('- Go to Supabase Dashboard > Authentication > URL Configuration');
console.log('- Add these URLs to the "Redirect URLs" list');

console.log('\n✅ If everything works:');
console.log('- Clicking email confirmation links should open your app');
console.log('- The app should automatically sign you in');
console.log('- You should see "Signup confirmed successfully" in the console');
