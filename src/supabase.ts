import { createClient } from '@supabase/supabase-js';

// Environment variables are loaded by main.ts, but we still need this for redundancy
import * as dotenv from 'dotenv';
import * as path from 'path';
import { existsSync } from 'fs';

// Try to load environment file if not already loaded
if (!process.env.REACT_APP_SUPABASE_URL) {
  const envPaths = [
    path.join(process.resourcesPath || '', '.env.production'),
    path.join(__dirname, '../.env.production'),
    path.join(__dirname, '../../.env.production'),
    path.resolve(__dirname, '../.env.production')
  ];
  
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      console.log(`Supabase module loading environment from: ${envPath}`);
      dotenv.config({ path: envPath });
      break;
    }
  }
  
  // Final fallback - set directly for packaged apps
  if (!process.env.REACT_APP_SUPABASE_URL && process.env.NODE_ENV === 'production') {
    process.env.REACT_APP_SUPABASE_URL = 'https://xslphflkpeyfqcwwlrih.supabase.co';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzbHBoZmxrcGV5ZnFjd3dscmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyNzkwNTgsImV4cCI6MjA2ODg1NTA1OH0.WICKm7rDZ899epi_0Nz7N435V2WEQI5sNxSzCoJ40EQ';
    console.log('Applied fallback environment variables in supabase module');
  }
}

dotenv.config();

// Import the custom storage adapter for Electron
import { ElectronStorageAdapter } from './electron-storage-adapter';

// Supabase configuration (Node/Electron uses process.env)
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Log successful configuration load
if (process.env.LOG_LEVEL === 'debug') {
  console.log('Environment debug info:', {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL_SET: !!SUPABASE_URL,
    SUPABASE_KEY_SET: !!SUPABASE_ANON_KEY
  });
}

// Validate environment variables
if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
  throw new Error(`REACT_APP_SUPABASE_URL environment variable is not set. 
    Current value: ${SUPABASE_URL || 'undefined'}
    Please ensure .env.production file is properly loaded.
    Current working directory: ${process.cwd()}
    Script location: ${__dirname}`);
}

if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
  throw new Error(`REACT_APP_SUPABASE_ANON_KEY environment variable is not set.
    Current value: ${SUPABASE_ANON_KEY ? 'set but invalid' : 'undefined'}
    Please ensure .env.production file is properly loaded.`);
}

// Only log in debug mode to avoid exposing sensitive info
if (process.env.LOG_LEVEL === 'debug') {
  console.log('Supabase configuration loaded:', {
    url: SUPABASE_URL,
    key: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 20) + '...' : 'not set'
  });
} else {
  console.log('Supabase configuration loaded successfully');
}

// Create Supabase client with custom auth options for Electron
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // For Electron apps, we need to handle the auth flow differently
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Disable automatic URL detection for Electron
    flowType: 'pkce', // Use PKCE flow for better security
    storage: new ElectronStorageAdapter() // Use custom storage for persistence
  },
  global: {
    headers: {
      'X-Client-Info': 'archivist-electron'
    }
  }
});

// Listen to auth state changes
supabase.auth.onAuthStateChange((event, session) => {
  if (process.env.LOG_LEVEL === 'debug') {
    console.log('Supabase auth state changed:', event, session?.user?.email);
  }
});

// Auth helper functions
export const auth = {
  // Sign in with email and password
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  },

  // Sign up with email and password
  signUp: async (email: string, password: string, name?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: name ? { full_name: name } : undefined,
        // No redirect - Supabase handles confirmation on their own page
      }
    });
    return { data, error };
  },

  // Sign out
  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  // Get current session
  getSession: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    return { session, error };
  },

  // Get current user
  getUser: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    return { user, error };
  },

  // Reset password
  resetPassword: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // No redirect - Supabase handles password reset on their own page
    });
    return { error };
  },

  // Update password
  updatePassword: async (password: string) => {
    const { error } = await supabase.auth.updateUser({
      password
    });
    return { error };
  },

  // Verify OTP (for email confirmation)
  verifyOtp: async (params: any) => {
    const { data, error } = await supabase.auth.verifyOtp(params);
    return { data, error };
  },

  // Listen to auth state changes
  onAuthStateChange: (callback: (event: string, session: any) => void) => {
    return supabase.auth.onAuthStateChange(callback);
  },

  // Set session manually (for protocol handling)
  setSession: async (accessToken: string, refreshToken: string) => {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    return { data, error };
  }
};

export default supabase; 