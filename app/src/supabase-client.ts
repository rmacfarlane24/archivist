import { createClient } from '@supabase/supabase-js';

// Client-side Supabase configuration
// Environment variables are embedded by Vite during build
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Validate environment variables
if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
  throw new Error('REACT_APP_SUPABASE_URL environment variable is not set. Please check your .env file.');
}

if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
  throw new Error('REACT_APP_SUPABASE_ANON_KEY environment variable is not set. Please check your .env file.');
}

// console.log('Client-side Supabase configuration loaded:', {
//   url: SUPABASE_URL,
//   key: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 20) + '...' : 'not set'
// });

// Create Supabase client for client-side use
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // For Electron apps, we need to handle the auth flow differently
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Disable automatic URL detection for Electron
    flowType: 'pkce' // Use PKCE flow for better security
  },
  global: {
    headers: {
      'X-Client-Info': 'archivist-electron-client'
    }
  }
});

// Listen to auth state changes
supabaseClient.auth.onAuthStateChange((event, session) => {
  // console.log('Client-side Supabase auth state changed:', event, session?.user?.email);
});

// Client-side auth helper functions
export const clientAuth = {
  // Sign in with email and password
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  },

  // Sign up with email and password
  signUp: async (email: string, password: string) => {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password
    });
    return { data, error };
  },

  // Sign out
  signOut: async () => {
    const { error } = await supabaseClient.auth.signOut();
    return { error };
  },

  // Get current session
  getSession: async () => {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    return { session, error };
  },

  // Get current user
  getUser: async () => {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    return { user, error };
  },

  // Reset password
  resetPassword: async (email: string) => {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: 'app://auth/reset-password'
    });
    return { error };
  },

  // Update password
  updatePassword: async (password: string) => {
    const { error } = await supabaseClient.auth.updateUser({
      password
    });
    return { error };
  }
}; 