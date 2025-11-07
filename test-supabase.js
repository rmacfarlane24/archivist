#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('🧪 Testing Supabase Connection');
console.log('==============================\n');

// Check environment variables
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
  console.log('❌ REACT_APP_SUPABASE_URL not set in .env file');
  process.exit(1);
}

if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
  console.log('❌ REACT_APP_SUPABASE_ANON_KEY not set in .env file');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log(`   URL: ${SUPABASE_URL}`);
console.log(`   Key: ${SUPABASE_ANON_KEY.substring(0, 20)}...`);

// Test Supabase connection
async function testConnection() {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    console.log('\n🔄 Testing connection...');
    
        // Test a simple query
    const { data, error } = await supabase.from('_dummy_table_').select('*').limit(1);
    
    if (error && (error.code === 'PGRST116' || error.message.includes('does not exist'))) {
      // This is expected - the table doesn't exist, but connection works
      console.log('✅ Supabase connection successful!');
      console.log('   (The error about missing table is expected)');
    } else if (error) {
      console.log('❌ Supabase connection failed:', error.message);
      process.exit(1);
    } else {
      console.log('✅ Supabase connection successful!');
    }
  
  console.log('\n🎉 Your Supabase setup is working correctly!');
  console.log('\n📋 Next steps:');
  console.log('1. Open http://localhost:5173/signin.html in your browser');
  console.log('2. Test the authentication flow');
  
  } catch (error) {
    console.log('❌ Failed to connect to Supabase:', error.message);
    process.exit(1);
  }
}

// Run the test
testConnection(); 