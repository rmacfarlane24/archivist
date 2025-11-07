#!/usr/bin/env node

/**
 * Test script to debug storage isolation between users
 * This will help identify why users are seeing each other's drives
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');

console.log('🔍 Testing Storage Isolation Between Users');
console.log('==========================================\n');

// Test 1: Check storage directory structure
function testStorageStructure() {
  console.log('1. Checking Storage Directory Structure...');
  
  const userDataPath = app.getPath('userData');
  const storagePath = path.join(userDataPath, 'storage');
  
  console.log(`   Base storage path: ${storagePath}`);
  
  if (fs.existsSync(storagePath)) {
    console.log('   ✅ Base storage directory exists');
    
    // Check for users subdirectory
    const usersPath = path.join(storagePath, 'users');
    if (fs.existsSync(usersPath)) {
      console.log('   ✅ Users subdirectory exists');
      
      // List existing user directories
      const userDirs = fs.readdirSync(usersPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      if (userDirs.length > 0) {
        console.log(`   📁 Found ${userDirs.length} user directories:`);
        userDirs.forEach(userDir => {
          const userStoragePath = path.join(usersPath, userDir);
          const catalogPath = path.join(userStoragePath, 'catalog.db');
          const hasCatalog = fs.existsSync(catalogPath);
          
          if (hasCatalog) {
            const stats = fs.statSync(catalogPath);
            console.log(`      - ${userDir} ✅ (catalog.db: ${stats.size} bytes, modified: ${stats.mtime})`);
          } else {
            console.log(`      - ${userDir} ❌ (catalog.db: missing)`);
          }
        });
      } else {
        console.log('   📁 No user directories found yet');
      }
    } else {
      console.log('   ❌ Users subdirectory missing');
    }
  } else {
    console.log('   ❌ Base storage directory missing');
  }
  
  console.log('');
}

// Test 2: Check for legacy storage files
function testLegacyStorage() {
  console.log('2. Checking for Legacy Storage Files...');
  
  const userDataPath = app.getPath('userData');
  const storagePath = path.join(userDataPath, 'storage');
  
  // Check for legacy catalog.db in root storage directory
  const legacyCatalogPath = path.join(storagePath, 'catalog.db');
  if (fs.existsSync(legacyCatalogPath)) {
    const stats = fs.statSync(legacyCatalogPath);
    console.log(`   ⚠️  Legacy catalog.db found in root storage: ${stats.size} bytes, modified: ${stats.mtime}`);
    console.log(`   📍 Path: ${legacyCatalogPath}`);
    console.log(`   ⚠️  This could be causing the issue - users might be loading from legacy storage!`);
  } else {
    console.log('   ✅ No legacy catalog.db in root storage');
  }
  
  // Check for legacy drive databases
  const legacyDriveFiles = fs.readdirSync(storagePath, { withFileTypes: true })
    .filter(dirent => dirent.isFile() && dirent.name.startsWith('drive_') && dirent.name.endsWith('.db'));
  
  if (legacyDriveFiles.length > 0) {
    console.log(`   ⚠️  Found ${legacyDriveFiles.length} legacy drive databases in root storage:`);
    legacyDriveFiles.forEach(file => {
      const filePath = path.join(storagePath, file.name);
      const stats = fs.statSync(filePath);
      console.log(`      - ${file.name}: ${stats.size} bytes, modified: ${stats.mtime}`);
    });
    console.log(`   ⚠️  These legacy files might be interfering with user isolation!`);
  } else {
    console.log('   ✅ No legacy drive databases in root storage');
  }
  
  console.log('');
}

// Test 3: Check user storage isolation
function testUserIsolation() {
  console.log('3. Testing User Storage Isolation...');
  
  const userDataPath = app.getPath('userData');
  const storagePath = path.join(userDataPath, 'storage');
  const usersPath = path.join(storagePath, 'users');
  
  if (fs.existsSync(usersPath)) {
    const userDirs = fs.readdirSync(usersPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    if (userDirs.length >= 2) {
      console.log('   ✅ Multiple users detected - checking isolation...');
      
      // Check that each user has their own catalog.db
      userDirs.forEach(userDir => {
        const userStoragePath = path.join(usersPath, userDir);
        const catalogPath = path.join(userStoragePath, 'catalog.db');
        
        if (fs.existsSync(catalogPath)) {
          const stats = fs.statSync(catalogPath);
          console.log(`      - ${userDir}: catalog.db (${stats.size} bytes, modified: ${stats.mtime})`);
          
          // Check if this user has any drive databases
          const userDriveFiles = fs.readdirSync(userStoragePath, { withFileTypes: true })
            .filter(dirent => dirent.isFile() && dirent.name.startsWith('drive_') && dirent.name.endsWith('.db'));
          
          if (userDriveFiles.length > 0) {
            console.log(`        📁 Has ${userDriveFiles.length} drive databases`);
          } else {
            console.log(`        📁 No drive databases yet`);
          }
        }
      });
      
      console.log('   ✅ Each user has isolated storage');
    } else if (userDirs.length === 1) {
      console.log('   ℹ️  Single user detected - isolation test requires multiple users');
    } else {
      console.log('   ℹ️  No users yet - isolation test requires users to sign in');
    }
  }
  
  console.log('');
}

// Test 4: Check for potential issues
function checkPotentialIssues() {
  console.log('4. Potential Issues Analysis...');
  
  const userDataPath = app.getPath('userData');
  const storagePath = path.join(userDataPath, 'storage');
  
  // Issue 1: Legacy storage in root directory
  const legacyCatalogPath = path.join(storagePath, 'catalog.db');
  if (fs.existsSync(legacyCatalogPath)) {
    console.log('   ❌ ISSUE 1: Legacy catalog.db exists in root storage');
    console.log('      This means the app might be loading from the wrong database');
    console.log('      Solution: Remove legacy files or ensure proper user switching');
  }
  
  // Issue 2: Mixed storage structure
  const usersPath = path.join(storagePath, 'users');
  if (fs.existsSync(usersPath) && fs.existsSync(legacyCatalogPath)) {
    console.log('   ❌ ISSUE 2: Mixed storage structure detected');
    console.log('      Both legacy and user-specific storage exist');
    console.log('      This could cause confusion in the storage manager');
  }
  
  // Issue 3: No user directories
  if (!fs.existsSync(usersPath)) {
    console.log('   ❌ ISSUE 3: No user directories created');
    console.log('      The user isolation system might not be working');
  }
  
  console.log('');
}

// Main test execution
async function runTests() {
  try {
    testStorageStructure();
    testLegacyStorage();
    testUserIsolation();
    checkPotentialIssues();
    
    console.log('🎯 Debugging Summary:');
    console.log('   - Check if legacy storage files exist in root directory');
    console.log('   - Verify user directories are being created');
    console.log('   - Ensure storage manager is switching databases properly');
    console.log('   - Check console logs for storage switching messages');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests();
