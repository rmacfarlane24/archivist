#!/usr/bin/env node

const { app } = require('electron');
const path = require('path');

console.log('🧪 Testing app:// Protocol');
console.log('==========================\n');

// Test if the app:// protocol is registered
const isProtocolRegistered = app.isDefaultProtocolClient('app');
console.log(`✅ app:// protocol registered: ${isProtocolRegistered}`);

// Test protocol handler
const testUrl = 'app://localhost:5173';
console.log(`🔗 Test URL: ${testUrl}`);

console.log('\n📋 How to test the app:// protocol:');
console.log('1. The Electron app should be running with app:// protocol');
console.log('2. When you start the app, it should load with app:// URLs');
console.log('3. Authentication redirects should use app:// protocol');
console.log('4. Skip auth should redirect to app://');

console.log('\n🎯 Expected behavior:');
console.log('- App starts with app:// protocol');
console.log('- Signin page uses app://signin.html');
console.log('- After auth, redirects to app://');
console.log('- Skip auth works with app:// protocol'); 