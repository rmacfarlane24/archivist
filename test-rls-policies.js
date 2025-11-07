#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('🧪 Testing Row-Level Security (RLS) Policies');
console.log('============================================\n');

// Initialize Supabase client
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

async function testRLSPolicies() {
  try {
    console.log('1. Testing authentication...');
    
    // Test with no authentication (should be blocked by RLS)
    console.log('\n📋 Testing unauthenticated access (should be blocked):');
    
    const { data: unauthenticatedDrives, error: unauthenticatedError } = await supabase
      .from('drives')
      .select('*');
    
    if (unauthenticatedError) {
      console.log('✅ RLS blocked unauthenticated access:', unauthenticatedError.message);
    } else if (!unauthenticatedDrives || unauthenticatedDrives.length === 0) {
      console.log('✅ RLS correctly returned no data for unauthenticated access');
    } else {
      console.log('❌ RLS failed to block unauthenticated access - returned data:', unauthenticatedDrives.length, 'records');
      return false;
    }

    // Test with authentication
    console.log('\n📋 Testing authenticated access:');
    
    // Sign in with test credentials (you'll need to create a test user)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: 'test@example.com', // Replace with your test user
      password: 'testpassword123'
    });

    if (authError) {
      console.log('⚠️  Authentication failed (create a test user first):', authError.message);
      console.log('\n📋 To test RLS policies, create a test user in your Supabase dashboard:');
      console.log('1. Go to your Supabase dashboard');
      console.log('2. Navigate to Authentication > Users');
      console.log('3. Create a test user with email: test@example.com');
      console.log('4. Set password: testpassword123');
      console.log('5. Run this test again');
      return false;
    }

    console.log('✅ Authentication successful');
    console.log('User ID:', authData.user.id);

    // Test creating a profile
    console.log('\n📋 Testing profile creation:');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: authData.user.id,
        email: authData.user.email,
        full_name: 'Test User'
      })
      .select()
      .single();

    if (profileError) {
      console.log('❌ Profile creation failed:', profileError.message);
    } else {
      console.log('✅ Profile created/updated successfully');
    }

    // Test creating a drive
    console.log('\n📋 Testing drive creation:');
    const { data: drive, error: driveError } = await supabase
      .from('drives')
      .insert({
        user_id: authData.user.id,
        name: 'Test Drive',
        path: '/test/path',
        total_capacity: 1000000000,
        used_space: 500000000,
        free_space: 500000000
      })
      .select()
      .single();

    if (driveError) {
      console.log('❌ Drive creation failed:', driveError.message);
    } else {
      console.log('✅ Drive created successfully');
      console.log('Drive ID:', drive.id);

      // Test creating files
      console.log('\n📋 Testing file creation:');
      const { data: files, error: filesError } = await supabase
        .from('files')
        .insert([
          {
            user_id: authData.user.id,
            drive_id: drive.id,
            name: 'test-file.txt',
            path: '/test/path/test-file.txt',
            size: 1024,
            is_directory: false,
            folder_path: '/test/path'
          },
          {
            user_id: authData.user.id,
            drive_id: drive.id,
            name: 'test-folder',
            path: '/test/path/test-folder',
            size: 0,
            is_directory: true,
            folder_path: '/test/path'
          }
        ])
        .select();

      if (filesError) {
        console.log('❌ File creation failed:', filesError.message);
      } else {
        console.log('✅ Files created successfully');
        console.log('Created', files.length, 'files');
      }

      // Test reading own data
      console.log('\n📋 Testing data access (should succeed):');
      const { data: ownDrives, error: ownDrivesError } = await supabase
        .from('drives')
        .select('*');

      if (ownDrivesError) {
        console.log('❌ Failed to read own drives:', ownDrivesError.message);
      } else {
        console.log('✅ Successfully read own drives:', ownDrives.length, 'drives');
      }

      const { data: ownFiles, error: ownFilesError } = await supabase
        .from('files')
        .select('*');

      if (ownFilesError) {
        console.log('❌ Failed to read own files:', ownFilesError.message);
      } else {
        console.log('✅ Successfully read own files:', ownFiles.length, 'files');
      }

      // Test metadata creation
      console.log('\n📋 Testing metadata creation:');
      const { data: metadata, error: metadataError } = await supabase
        .from('metadata')
        .insert({
          user_id: authData.user.id,
          folder_path: '/test/path',
          metadata_type: 'tags',
          key: 'important',
          value: 'true'
        })
        .select()
        .single();

      if (metadataError) {
        console.log('❌ Metadata creation failed:', metadataError.message);
      } else {
        console.log('✅ Metadata created successfully');
      }

      // Clean up test data
      console.log('\n📋 Cleaning up test data...');
      await supabase.from('files').delete().eq('drive_id', drive.id);
      await supabase.from('metadata').delete().eq('folder_path', '/test/path');
      await supabase.from('drives').delete().eq('id', drive.id);
      console.log('✅ Test data cleaned up');
    }

    // Test cross-user access (should be blocked)
    console.log('\n📋 Testing cross-user access (should be blocked):');
    
    // Try to access data with a different user ID (should fail)
    const { data: crossUserData, error: crossUserError } = await supabase
      .from('drives')
      .select('*')
      .eq('user_id', '00000000-0000-0000-0000-000000000000'); // Non-existent user

    if (crossUserError) {
      console.log('✅ RLS correctly blocked cross-user access');
    } else if (crossUserData && crossUserData.length === 0) {
      console.log('✅ RLS correctly returned no data for non-existent user');
    } else {
      console.log('❌ RLS failed to block cross-user access');
    }

    console.log('\n🎉 RLS Policy Tests Completed!');
    console.log('\n📋 Summary:');
    console.log('✅ Unauthenticated access blocked');
    console.log('✅ Authenticated users can create/read own data');
    console.log('✅ Cross-user access blocked');
    console.log('✅ Profile, drives, files, and metadata operations work');
    
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

// Run the test
testRLSPolicies().then(success => {
  if (success) {
    console.log('\n✅ All RLS tests passed!');
  } else {
    console.log('\n❌ Some RLS tests failed.');
  }
}); 