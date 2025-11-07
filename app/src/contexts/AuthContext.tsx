import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabaseClient } from '../supabase-client';
import { useAuthStateManager } from './AuthStateManager';
import { AuthStateType } from '../types/auth';

// Backward compatibility interface - maintains the same API as before
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  updateProfile: (updates: any) => Promise<void>;
  // New fields for enhanced functionality
  error: string | null;
  storageReady: boolean;
  driveCount: number | undefined;
  driveLoadError: string | null;
  recoverFromError: (operation: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Use the AuthStateManager for state management
  const authStateManager = useAuthStateManager();
  
  // Backward compatibility state - derived from AuthStateManager
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [driveCount, setDriveCount] = useState<number | undefined>(undefined);
  const [driveLoadError, setDriveLoadError] = useState<string | null>(null);

  // Sync AuthStateManager state to backward compatibility state
  useEffect(() => {
    const { state } = authStateManager;
    
    // Update user and session from AuthStateManager
    setUser(state.user);
    setSession(state.session);
    
    // Update loading state based on AuthStateManager state
    const isLoading = state.loading || 
                     state.state === 'UNINITIALIZED' || 
                     state.state === 'CHECKING';
    setLoading(isLoading);
    
    // Update new fields from AuthStateManager
    setError(state.error);
    setStorageReady(state.storageReady);
    setDriveCount(state.driveCount);
    setDriveLoadError(state.driveLoadError);
    
    // Sync session to Supabase client when authenticated
    if (state.state === 'AUTHENTICATED' && state.session) {
      supabaseClient.auth.setSession(state.session).catch((error) => {
        console.error('Failed to sync session to Supabase client:', error);
      });
    }
  }, [authStateManager.state]);

  // Enhanced signOut that uses AuthStateManager
  const signOut = async () => {
    try {
      await authStateManager.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  // Enhanced updateProfile that updates AuthStateManager state
  const updateProfile = async (updates: any) => {
    try {
      if (user) {
        const updatedUser = { ...user, user_metadata: { ...user.user_metadata, ...updates } };
        
        // Update AuthStateManager state
        authStateManager.setState({ user: updatedUser });
        
        // Update local state for backward compatibility
        setUser(updatedUser);
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  };

  // Provide backward compatibility context value
  const contextValue: AuthContextType = {
    user,
    session,
    loading,
    signOut,
    updateProfile,
    error,
    storageReady,
    driveCount,
    driveLoadError,
    recoverFromError: authStateManager.recoverFromError
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

// Backward compatibility hook
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Enhanced hook that provides both backward compatibility and new state manager
export const useAuthEnhanced = () => {
  const authContext = useAuth();
  const authStateManager = useAuthStateManager();
  
  return {
    // Backward compatibility
    ...authContext,
    
    // New state manager functionality
    state: authStateManager.state,
    isState: authStateManager.isState,
    canTransitionTo: authStateManager.canTransitionTo,
    getStateInfo: authStateManager.getStateInfo,
    clearError: authStateManager.clearError,
    retryLastOperation: authStateManager.retryLastOperation,
    recoverFromError: authStateManager.recoverFromError,
    
    // State convenience methods
    isAuthenticated: authStateManager.isState('AUTHENTICATED'),
    isStorageReady: authStateManager.isState('STORAGE_READY'),
    isDataLoaded: authStateManager.isState('DATA_LOADED'),
    isAnonymous: authStateManager.isState('ANONYMOUS'),
    isLoading: authStateManager.state.loading,
    hasError: !!authStateManager.state.error,
    error: authStateManager.state.error,
    
    // Enhanced convenience methods
    storageReady: authStateManager.state.storageReady,
    driveCount: authStateManager.state.driveCount,
    driveLoadError: authStateManager.state.driveLoadError,
    drives: authStateManager.state.drives,
    canRecover: !!authStateManager.state.error && authStateManager.state.error.includes('Storage'),
    canRetry: authStateManager.state.error !== null
  };
};

// Hook for components that need error recovery functionality
export const useAuthErrorRecovery = () => {
  const authStateManager = useAuthStateManager();
  
  return {
    // Error recovery functions
    recoverFromError: authStateManager.recoverFromError,
    retryLastOperation: authStateManager.retryLastOperation,
    clearError: authStateManager.clearError,
    
    // Error state
    error: authStateManager.state.error,
    hasError: !!authStateManager.state.error,
    isLoading: authStateManager.state.loading,
    
    // Recovery state
    canRecover: !!authStateManager.state.error && authStateManager.state.error.includes('Storage'),
    canRetry: authStateManager.state.error !== null,
    
    // State information
    currentState: authStateManager.state.state,
    getStateInfo: authStateManager.getStateInfo
  };
};

// Hook for components that need storage-specific functionality
export const useAuthStorage = () => {
  const authStateManager = useAuthStateManager();
  
  return {
    // Storage state
    storageReady: authStateManager.state.storageReady,
    storageReadyAt: authStateManager.state.storageReadyAt,
    userId: authStateManager.state.userId,
    
    // Drive information
    driveCount: authStateManager.state.driveCount,
    driveLoadError: authStateManager.state.driveLoadError,
    drivesLoaded: authStateManager.state.drivesLoaded,
    
    // Storage convenience methods
    isStorageReady: authStateManager.state.storageReady,
    hasDrives: authStateManager.state.driveCount !== undefined && authStateManager.state.driveCount > 0,
    hasDriveError: !!authStateManager.state.driveLoadError,
    
    // Storage operations
    initializeStorage: authStateManager.initializeStorage,
    
    // State information
    currentState: authStateManager.state.state,
    isState: authStateManager.isState
  };
};
