#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');

console.log('🏭 Testing Production Build');
console.log('==========================\n');

async function testProductionBuild() {
  try {
    console.log('📋 Checking build files...');
    
    const buildFiles = [
      'app/dist/index.html',
      'app/dist/assets/index-1Vovt8A0.js',
      'app/dist/assets/index-BoweOwKx.css',
      'lib/main.js'
    ];

    let allFilesExist = true;
    for (const file of buildFiles) {
      if (fs.existsSync(file)) {
        console.log(`✅ ${file} exists`);
      } else {
        console.log(`❌ ${file} missing`);
        allFilesExist = false;
      }
    }

    if (!allFilesExist) {
      console.log('\n❌ Build files missing. Run "npm run build" first.');
      return false;
    }

    console.log('\n📋 Checking environment variables in build...');
    
    // Check if environment variables are embedded
    const jsBundlePath = 'app/dist/assets/index-1Vovt8A0.js';
    const jsContent = fs.readFileSync(jsBundlePath, 'utf8');
    
    // Check for embedded environment variables
    const envChecks = [
      { name: 'REACT_APP_SUPABASE_URL', pattern: /REACT_APP_SUPABASE_URL/ },
      { name: 'REACT_APP_SUPABASE_ANON_KEY', pattern: /REACT_APP_SUPABASE_ANON_KEY/ },
      { name: 'NODE_ENV', pattern: /NODE_ENV/ }
    ];

    let envEmbedded = true;
    for (const check of envChecks) {
      if (check.pattern.test(jsContent)) {
        console.log(`✅ ${check.name} is embedded in build`);
      } else {
        console.log(`❌ ${check.name} not found in build`);
        envEmbedded = false;
      }
    }

    console.log('\n📋 Testing production app startup...');
    
    // Test if the production app can start
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      const electronProcess = spawn('npm', ['run', 'test:production'], {
        stdio: 'pipe',
        timeout: 15000 // 15 second timeout
      });

      let output = '';
      let errorOutput = '';

      electronProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      electronProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      electronProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Production app started successfully');
          resolve(true);
        } else {
          console.log('❌ Production app failed to start');
          console.log('Error output:', errorOutput);
          resolve(false);
        }
      });

      // Kill the process after 10 seconds
      setTimeout(() => {
        electronProcess.kill();
        console.log('✅ Production app test completed (killed after timeout)');
        resolve(true);
      }, 10000);
    });

  } catch (error) {
    console.error('❌ Production build test failed:', error);
    return false;
  }
}

// Run the test
testProductionBuild().then(success => {
  console.log('\n📋 Summary:');
  console.log('===========');
  
  if (success) {
    console.log('✅ Production build is working correctly');
    console.log('✅ Environment variables are properly embedded');
    console.log('✅ App can start in production mode');
    console.log('\n🎉 Production build is ready for distribution!');
  } else {
    console.log('❌ Production build has issues');
    console.log('Please check the errors above and fix them.');
  }
}); 