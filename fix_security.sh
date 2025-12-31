#!/bin/bash

# Supabase Security Fixes Application Script

echo "🔐 Supabase Security Fixes"
echo "========================="
echo ""

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first:"
    echo "   npm install -g supabase"
    exit 1
fi

echo "✅ Supabase CLI found"

# Check if we're linked to a project
if [ ! -f "supabase/config.toml" ]; then
    echo "❌ No Supabase project found. Make sure you're in the right directory."
    exit 1
fi

echo "✅ Supabase project detected"
echo ""

echo "🚀 Applying database security fixes..."
echo ""

# Check if project is linked
if supabase status 2>/dev/null | grep -q "API URL"; then
    # Project is linked, try to push
    if supabase db push; then
        echo ""
        echo "✅ Database security fixes applied successfully!"
        echo ""
    else
        echo ""
        echo "❌ Push failed. Let's use the manual method instead."
        echo ""
        show_manual_method=true
    fi
else
    echo "ℹ️ Project not linked to Supabase CLI. Using manual method."
    echo ""
    show_manual_method=true
fi

if [ "$show_manual_method" = true ]; then
    echo "📋 MANUAL DATABASE FIXES (5 minutes):"
    echo "====================================="
    echo ""
    echo "1. Open your Supabase Dashboard:"
    echo "   https://supabase.com/dashboard/project/xslphflkpeyfqcwwlrih/sql/new"
    echo ""
    echo "2. Copy the SQL from this file:"
    echo "   $(pwd)/supabase/migrations/20241229000001_fix_function_security.sql"
    echo ""
    echo "3. Paste it into the SQL Editor and click 'Run'"
    echo ""
    echo "4. You should see 'Success. No rows returned' - that's perfect!"
    echo ""
    read -p "Press ENTER after you've completed the SQL fixes..."
    echo ""
    echo "✅ Great! Database fixes should now be applied."
    echo ""
fi

echo "📋 MANUAL STEPS REMAINING:"
echo "========================="
echo ""
echo "🔹 1. Fix OTP Expiry (5 minutes):"
echo "   → Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/auth/users"
echo "   → Click 'Settings' → 'Auth' → 'Email'"
echo "   → Set 'Confirm signup' expiry to 3600 seconds (1 hour)"
echo "   → Save changes"
echo ""
echo "🔹 2. Enable Leaked Password Protection (2 minutes):"
echo "   → Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/auth/users"  
echo "   → Click 'Settings' → 'Auth' → 'Password'"
echo "   → Enable 'Check against HaveIBeenPwned.org'"
echo "   → Save changes"
echo ""
echo "🔹 3. Schedule Database Upgrade (10 minutes):"
echo "   → Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/general"
echo "   → Look for 'Database version' section"
echo "   → Click 'Upgrade' if available"
echo "   → Schedule during low-traffic time"
echo ""
echo "⏰ Total time needed: ~15 minutes of manual work"
echo ""
echo "🎉 After completing these steps, all security warnings will be resolved!"
