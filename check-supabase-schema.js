#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('🔍 Checking Supabase Database Schema');
console.log('====================================\n');

// Initialize Supabase client
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

async function checkSchema() {
  try {
    console.log('📋 Checking existing tables...\n');

    // Check if tables exist by trying to query them
    const tables = ['profiles', 'drives', 'files', 'metadata'];
    const tableStatus = {};

    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error && error.message.includes('does not exist')) {
          tableStatus[table] = 'missing';
          console.log(`❌ Table '${table}': MISSING`);
        } else if (error) {
          tableStatus[table] = 'error';
          console.log(`⚠️  Table '${table}': ERROR - ${error.message}`);
        } else {
          tableStatus[table] = 'exists';
          console.log(`✅ Table '${table}': EXISTS`);
        }
      } catch (err) {
        tableStatus[table] = 'error';
        console.log(`⚠️  Table '${table}': ERROR - ${err.message}`);
      }
    }

    console.log('\n📋 Checking RLS status...\n');

    // Check RLS status by trying to access data without authentication
    for (const table of tables) {
      if (tableStatus[table] === 'exists') {
        try {
          const { data, error } = await supabase
            .from(table)
            .select('*')
            .limit(1);

          if (error && error.message.includes('policy')) {
            console.log(`✅ Table '${table}': RLS ENABLED (blocked by policy)`);
          } else if (data && data.length === 0) {
            console.log(`✅ Table '${table}': RLS ENABLED (returned empty array)`);
          } else if (data && data.length > 0) {
            console.log(`❌ Table '${table}': RLS DISABLED (returned data)`);
          } else {
            console.log(`✅ Table '${table}': RLS ENABLED (no data returned)`);
          }
        } catch (err) {
          console.log(`⚠️  Table '${table}': RLS CHECK ERROR - ${err.message}`);
        }
      }
    }

    console.log('\n📋 Summary:');
    const existingTables = Object.values(tableStatus).filter(status => status === 'exists').length;
    const missingTables = Object.values(tableStatus).filter(status => status === 'missing').length;
    
    console.log(`Tables: ${existingTables} existing, ${missingTables} missing`);
    
    if (missingTables === 0) {
      console.log('✅ All required tables exist!');
      console.log('\n📋 If you need to update the schema, use the incremental schema file.');
    } else {
      console.log('⚠️  Some tables are missing. Run the full schema file.');
    }

    return tableStatus;

  } catch (error) {
    console.error('❌ Schema check failed:', error);
    return null;
  }
}

// Run the check
checkSchema().then(status => {
  if (status) {
    console.log('\n🎉 Schema check completed!');
  } else {
    console.log('\n❌ Schema check failed.');
  }
}); 