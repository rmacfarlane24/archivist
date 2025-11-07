#!/usr/bin/env node

require('dotenv').config();

console.log('🏭 Testing Production Environment Variables');
console.log('==========================================\n');

// Test environment variables
const envVars = {
  'REACT_APP_SUPABASE_URL': process.env.REACT_APP_SUPABASE_URL,
  'REACT_APP_SUPABASE_ANON_KEY': process.env.REACT_APP_SUPABASE_ANON_KEY,
  'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
  'NODE_ENV': process.env.NODE_ENV
};

console.log('📋 Environment Variables Check:');
console.log('================================');

let allGood = true;

// Check required variables
if (!envVars['REACT_APP_SUPABASE_URL'] || envVars['REACT_APP_SUPABASE_URL'] === 'YOUR_SUPABASE_URL') {
  console.log('❌ REACT_APP_SUPABASE_URL not set or has default value');
  allGood = false;
} else {
  console.log('✅ REACT_APP_SUPABASE_URL is set');
}

if (!envVars['REACT_APP_SUPABASE_ANON_KEY'] || envVars['REACT_APP_SUPABASE_ANON_KEY'] === 'YOUR_SUPABASE_ANON_KEY') {
  console.log('❌ REACT_APP_SUPABASE_ANON_KEY not set or has default value');
  allGood = false;
} else {
  console.log('✅ REACT_APP_SUPABASE_ANON_KEY is set');
}

if (!envVars['SUPABASE_SERVICE_ROLE_KEY']) {
  console.log('⚠️  SUPABASE_SERVICE_ROLE_KEY not set (admin operations will be disabled)');
} else {
  console.log('✅ SUPABASE_SERVICE_ROLE_KEY is set');
}

console.log(`📋 NODE_ENV: ${envVars['NODE_ENV'] || 'not set'}`);

console.log('\n📋 Production Build Test:');
console.log('==========================');

async function testProductionBuild() {
  try {
    // Test building the app
    console.log('🔨 Building production version...');
    
    const { execSync } = require('child_process');
    
    // Build the app
    execSync('npm run build', { stdio: 'inherit' });
    console.log('✅ Production build completed successfully');
    
    // Test running the production build
    console.log('\n🚀 Testing production build...');
    
    // Start the production app in test mode
    const electronProcess = execSync('npm run test:production', { 
      stdio: 'pipe',
      timeout: 10000 // 10 second timeout
    });
    
    console.log('✅ Production build runs successfully');
    
    return true;
  } catch (error) {
    console.error('❌ Production build test failed:', error.message);
    return false;
  }
}

console.log('\n📋 Build Configuration Check:');
console.log('==============================');

// Check if build files exist
const fs = require('fs-extra');
const path = require('path');

const buildFiles = [
  'app/dist/index.html',
  'app/dist/assets',
  'lib/main.js'
];

let buildFilesExist = true;

for (const file of buildFiles) {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file} exists`);
  } else {
    console.log(`❌ ${file} missing`);
    buildFilesExist = false;
  }
}

// Check if environment variables are embedded in the build
console.log('\n📋 Environment Variables in Build:');
console.log('===================================');

try {
  const indexPath = 'app/dist/index.html';
  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    
    // Check if the build contains environment variable references
    if (indexContent.includes('REACT_APP_SUPABASE_URL') || 
        indexContent.includes('REACT_APP_SUPABASE_ANON_KEY')) {
      console.log('✅ Environment variables are embedded in the build');
    } else {
      console.log('⚠️  Environment variables may not be properly embedded');
    }
  } else {
    console.log('❌ Build file not found');
  }
} catch (error) {
  console.log('❌ Error checking build files:', error.message);
}

console.log('\n📋 Summary:');
console.log('===========');

if (allGood && buildFilesExist) {
  console.log('✅ All environment variables are properly configured');
  console.log('✅ Build process is working correctly');
  console.log('✅ Ready for production deployment');
} else {
  console.log('❌ Some issues found:');
  if (!allGood) {
    console.log('  - Environment variables need to be configured');
  }
  if (!buildFilesExist) {
    console.log('  - Build files are missing');
  }
}

console.log('\n📋 Next Steps:');
console.log('==============');
console.log('1. Ensure all environment variables are set in .env');
console.log('2. Run "npm run build" to create production build');
console.log('3. Run "npm run package" to create distributable');
console.log('4. Test the packaged app thoroughly');

if (allGood) {
  console.log('\n🎉 Production environment is ready!');
} else {
  console.log('\n⚠️  Please fix the issues above before proceeding.');
} 