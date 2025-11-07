#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Supabase Environment Setup');
console.log('=============================\n');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('❌ .env file not found. Creating one...');
  fs.writeFileSync(envPath, '');
}

// Read current .env content
let envContent = fs.readFileSync(envPath, 'utf8');

// Check if Supabase config already exists
if (envContent.includes('SUPABASE_URL')) {
  console.log('✅ .env file already contains Supabase configuration');
  console.log('\nCurrent configuration:');
  const lines = envContent.split('\n');
  lines.forEach(line => {
    if (line.startsWith('SUPABASE_')) {
      console.log(`  ${line}`);
    }
  });
} else {
  console.log('📝 Adding Supabase configuration template to .env file...');
  
  const template = `
# Supabase Configuration
# Replace these with your actual Supabase project credentials
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Optional: Set to true to enable debug logging
DEBUG=false
`.trim();

  // Add template to .env file
  if (envContent && !envContent.endsWith('\n')) {
    envContent += '\n';
  }
  envContent += '\n' + template;
  
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Template added to .env file');
}

console.log('\n📋 Next Steps:');
console.log('1. Open the .env file in your editor');
console.log('2. Replace the placeholder values with your actual Supabase credentials');
console.log('3. Save the file');
console.log('4. Run "npm run dev" to test your setup');
console.log('\n🔗 Get your credentials from: https://supabase.com/dashboard/project/[your-project]/settings/api'); 