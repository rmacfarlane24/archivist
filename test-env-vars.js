#!/usr/bin/env node

require('dotenv').config();

console.log('🧪 Testing Environment Variables Configuration');
console.log('============================================\n');

// Check if environment variables are available
const REACT_APP_SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const REACT_APP_SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const NODE_ENV = process.env.NODE_ENV;

console.log('Environment Variables:');
console.log(`  NODE_ENV: ${NODE_ENV || 'not set'}`);
console.log(`  REACT_APP_SUPABASE_URL: ${REACT_APP_SUPABASE_URL ? 'set' : 'not set'}`);
console.log(`  REACT_APP_SUPABASE_ANON_KEY: ${REACT_APP_SUPABASE_ANON_KEY ? 'set' : 'not set'}`);

if (REACT_APP_SUPABASE_URL && REACT_APP_SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
  console.log('\n✅ REACT_APP_SUPABASE_URL is properly configured');
} else {
  console.log('\n❌ REACT_APP_SUPABASE_URL is not set or has default value');
}

if (REACT_APP_SUPABASE_ANON_KEY && REACT_APP_SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY') {
  console.log('✅ REACT_APP_SUPABASE_ANON_KEY is properly configured');
} else {
  console.log('❌ REACT_APP_SUPABASE_ANON_KEY is not set or has default value');
}

console.log('\n📋 Next steps:');
console.log('1. Create a .env file with your Supabase credentials');
console.log('2. Run "npm run build" to test the build process');
console.log('3. Test that the app can access Supabase in production'); 