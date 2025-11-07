import { createClient } from '@supabase/supabase-js';

// Ensure dotenv is loaded
import * as dotenv from 'dotenv';
dotenv.config();

// Import the custom storage adapter for Electron
import { ElectronStorageAdapter } from './electron-storage-adapter';

// Supabase configuration
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Validate environment variables
if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
  throw new Error('REACT_APP_SUPABASE_URL environment variable is not set. Please check your .env file.');
}

if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
  throw new Error('REACT_APP_SUPABASE_ANON_KEY environment variable is not set. Please check your .env file.');
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