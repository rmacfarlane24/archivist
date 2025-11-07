import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { 
  AuthState, 
  AuthStateType, 
  AuthStateManagerContextType, 
  AuthStateManagerConfig,
  isStateTransitionValid,
  getInitialAuthState,
  VALID_TRANSITIONS
} from '../types/auth';

// Default configuration
const DEFAULT_CONFIG: AuthStateManagerConfig = {
  storageSwitchDebounceMs: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
  sessionValidationTimeoutMs: 10000,
  storageInitTimeoutMs: 15000,
  enableErrorRecovery: true,
  enableAutoRetry: true
};

// Create context
const AuthStateManagerContext = createContext<AuthStateManagerContextType | undefined>(undefined);

interface AuthStateManagerProviderProps {
  children: React.ReactNode;
  config?: Partial<AuthStateManagerConfig>;
}

export const AuthStateManagerProvider: React.FC<AuthStateManagerProviderProps> = ({ 
  children, 
  config = {} 
}) => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // State
  const [state, setState] = useState<AuthState>(getInitialAuthState());
  
  // Refs for tracking operations
  const lastOperationRef = useRef<{ type: string; params?: any } | null>(null);
  const storageSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  
  // Memoized event handlers to prevent infinite re-renders
  const handleStorageReady = useCallback((data: any) => {
    // console.log(`[AuthStateManager] Storage ready notification received:`, data);
    setState(prev => ({ 
      ...prev, 
      storageReady: data.ready,
      storageReadyAt: data.ready ? new Date() : null,
      driveCount: data.driveCount || 0,
      driveLoadError: data.driveLoadError || null
    }));
  }, []);

  const handleStorageError = useCallback((data: any) => {
    console.error(`[AuthStateManager] Storage error notification received:`, data);
    setState(prev => ({ 
      ...prev, 
      error: `Storage error (${data.phase}): ${data.error}`,
      loading: false
    }));
  }, []);

  const handleStorageRecoveryAttempt = useCallback((data: any) => {
    // console.log(`[AuthStateManager] Storage recovery attempt notification received:`, data);
    setState(prev => ({ 
      ...prev, 
      loading: true,
      error: null
    }));
  }, []);

  // Storage event listeners
  useEffect(() => {
    if (!window.electronAPI) return;
    
    // Set up listeners
    window.electronAPI.onStorageReady(handleStorageReady);
    window.electronAPI.onStorageError(handleStorageError);
    window.electronAPI.onStorageRecoveryAttempt(handleStorageRecoveryAttempt);
    
    // Cleanup listeners on unmount
    return () => {
      // Note: In a real implementation, you might want to remove listeners
      // but the current API doesn't provide a remove method
    };
  }, [handleStorageReady, handleStorageError, handleStorageRecoveryAttempt]);

  // Logging function with filtering (only warn and error by default)
  const log = useCallback((level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]) => {
    // Skip debug and info logs (too noisy)
    if (level === 'debug' || level === 'info') return;
    
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const prefix = `[${timestamp}] [AuthStateManager] [${level.toUpperCase()}]`;
    
    switch (level) {
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'error':
        console.error(prefix, message, ...args);
        break;
    }
  }, []);



  // State transition function with validation
  const transitionTo = useCallback(async (newStateType: AuthStateType): Promise<void> => {
    const currentState = state.state;
    
    log('info', `State transition requested: ${currentState} → ${newStateType}`);
    
    // Validate transition
    if (!isStateTransitionValid(currentState, newStateType)) {
      const error = `Invalid state transition: ${currentState} → ${newStateType}`;
      log('error', error);
      log('info', `Allowed transitions from ${currentState}:`, VALID_TRANSITIONS[currentState]);
      throw new Error(error);
    }
    
    // Update state
    const newState: AuthState = {
      ...state,
      state: newStateType,
      lastStateChange: new Date(),
      loading: false,
      error: null // Clear errors on successful transition
    };
    
    // Set specific timestamps based on state
    switch (newStateType) {
      case 'AUTHENTICATED':
        newState.sessionValidatedAt = new Date();
        break;
      case 'STORAGE_READY':
        newState.storageInitializedAt = new Date();
        newState.storageReady = true;
        break;
      case 'DATA_LOADED':
        newState.dataLoadedAt = new Date();
        newState.dataLoaded = true;
        break;
    }
    
    setState(newState);
    log('info', `State transition completed: ${currentState} → ${newStateType}`);
  }, [state, log]);

  // Debounced storage switching with enhanced IPC handlers
  const debouncedStorageSwitch = useCallback(async (userId: string | null): Promise<void> => {
    // Clear existing timeout
    if (storageSwitchTimeoutRef.current) {
      clearTimeout(storageSwitchTimeoutRef.current);
    }
    
    // Return a promise that resolves when the storage switch completes
    return new Promise<void>((resolve, reject) => {
      storageSwitchTimeoutRef.current = setTimeout(async () => {
      try {
        log('info', `Executing debounced storage switch to user: ${userId || 'anonymous'}`);
        
        if (window.electronAPI?.switchStorageUser) {
          const result = await window.electronAPI.switchStorageUser(userId);
          
          if (result.success) {
            log('info', `Storage switch completed successfully (phase: ${result.phase}, duration: ${result.duration}ms)`);
            
            // Update state with additional information
            if (result.userId && result.driveCount !== undefined) {
              setState(prev => ({ 
                ...prev, 
                userId: result.userId,
                driveCount: result.driveCount,
                driveLoadError: result.driveLoadError || null
              }));
            }
            
            // Log drive loading results
            if (result.driveLoadError) {
              log('warn', `Drive loading completed with warning: ${result.driveLoadError}`);
            } else if (result.driveCount !== undefined) {
              log('info', `Successfully loaded ${result.driveCount} drives`);
            }
            
            resolve();
          } else {
            throw new Error('Storage switch failed');
          }
        } else {
          throw new Error('Storage switch API not available');
        }
      } catch (error) {
        log('error', 'Storage switch failed:', error);
        setState(prev => ({ ...prev, error: `Storage switch failed: ${error}` }));
        reject(error);
      }
    }, finalConfig.storageSwitchDebounceMs);
      });
  }, [finalConfig.storageSwitchDebounceMs, log]);

  // Session validation
  const validateSession = useCallback(async (): Promise<void> => {
    log('info', 'Starting session validation');
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      if (!window.electronAPI?.authGetSession) {
        throw new Error('Authentication API not available');
      }
      
      const { session, error } = await window.electronAPI.authGetSession();
      
      if (error) {
        throw new Error(`Session validation failed: ${error}`);
      }
      
      if (session && session.user) {
        log('info', 'Valid session found, transitioning to AUTHENTICATED');
        setState(prev => ({ 
          ...prev, 
          state: 'AUTHENTICATED' as AuthStateType,
          user: session.user, 
          session: session,
          userId: session.user.id,
          loading: false
        }));
      } else {
        log('info', 'No valid session found, transitioning to ANONYMOUS');
        setState(prev => ({ 
          ...prev, 
          state: 'ANONYMOUS' as AuthStateType,
          loading: false
        }));
      }
    } catch (error) {
      log('error', 'Session validation failed:', error);
      setState(prev => ({ 
        ...prev, 
        error: `Session validation failed: ${error}`,
        loading: false,
        state: 'ANONYMOUS' as AuthStateType
      }));
    }
  }, []);

  // Storage initialization with enhanced IPC handlers
  const initializeStorage = useCallback(async (userId: string): Promise<void> => {
    log('info', `Initializing storage for user: ${userId}`);
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      // Execute storage switch and wait for completion
      await debouncedStorageSwitch(userId);
      
      // Wait for storage to be ready using enhanced IPC handlers
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Storage initialization timeout'));
        }, finalConfig.storageInitTimeoutMs);
        
        // Check if storage is ready using new IPC handlers
        let checkCount = 0;
        const maxChecks = 10; // Maximum 1 second of checking (10 * 100ms)
        
        const checkStorage = async () => {
          try {
            checkCount++;
            
            if (checkCount > maxChecks) {
              clearTimeout(timeout);
              reject(new Error('Storage readiness check timeout - exceeded maximum retries'));
              return;
            }
            
            if (window.electronAPI?.checkStorageReady) {
              const result = await window.electronAPI.checkStorageReady();
              
              log('debug', `Storage check result: ready=${result.ready}, userId=${result.userId}, error=${result.error}`);
              
              if (result.ready) {
                clearTimeout(timeout);
                log('info', `Storage ready confirmed via IPC (duration: ${result.duration || 'unknown'}ms)`);
                resolve();
                return;
              } else if (result.error) {
                clearTimeout(timeout);
                reject(new Error(`Storage readiness check failed: ${result.error}`));
                return;
              }
            }
            
            // Fallback to state check if IPC not available
            if (state.storageReady) {
              clearTimeout(timeout);
              resolve();
              return;
            }
            
            // Continue checking with exponential backoff
            const delay = Math.min(500, 200 * Math.pow(1.2, checkCount));
            setTimeout(checkStorage, delay);
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        };
        
        checkStorage();
      });
      
      log('info', 'Storage initialization completed');
      setState(prev => ({ 
        ...prev, 
        state: 'STORAGE_READY' as AuthStateType,
        storageReady: true,
        storageReadyAt: new Date(),
        loading: false
      }));
    } catch (error) {
      log('error', 'Storage initialization failed:', error);
      setState(prev => ({ 
        ...prev, 
        error: `Storage initialization failed: ${error}`,
        loading: false 
      }));
      throw error;
    }
  }, [debouncedStorageSwitch]);

  // Error recovery mechanism
  const recoverFromError = useCallback(async (operation: string): Promise<void> => {
    log('info', `Attempting to recover from error in operation: ${operation}`);
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      if (window.electronAPI?.recoverStorageError) {
        const result = await window.electronAPI.recoverStorageError(operation);
        
        if (result.success) {
          log('info', `Error recovery initiated: ${result.message}`);
          
          // Wait a bit for recovery to complete
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if recovery was successful
          if (window.electronAPI?.checkStorageHealth) {
            const healthResult = await window.electronAPI.checkStorageHealth();
            
            if (healthResult.healthy) {
              log('info', 'Error recovery completed successfully');
              setState(prev => ({ ...prev, loading: false }));
            } else {
              throw new Error(`Recovery failed: ${healthResult.error}`);
            }
          } else {
            log('info', 'Error recovery completed (health check not available)');
            setState(prev => ({ ...prev, loading: false }));
          }
        } else {
          throw new Error(`Recovery failed: ${result.error}`);
        }
      } else {
        throw new Error('Error recovery API not available');
      }
    } catch (error) {
      log('error', 'Error recovery failed:', error);
      setState(prev => ({ 
        ...prev, 
        error: `Error recovery failed: ${error}`,
        loading: false 
      }));
      throw error;
    }
  }, [log]);

  // User data loading with enhanced IPC integration
  const loadUserData = useCallback(async (): Promise<void> => {
    log('info', 'Loading user data');
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      // Check if drives were already loaded during storage switch
      if (state.driveCount !== undefined && state.driveCount > 0) {
        log('info', `Drives already loaded during storage switch: ${state.driveCount} drives`);
        setState(prev => ({ ...prev, drivesLoaded: true }));
      } else {
        // Load drives if not already loaded
        if (window.electronAPI?.getAllDrives) {
          const drives = await window.electronAPI.getAllDrives();
          log('info', `Loaded ${drives.length} drives`);
          setState(prev => ({ 
            ...prev, 
            drivesLoaded: true,
            driveCount: drives.length,
            drives: drives
          }));
        }
      }
      
      // Check storage health
      if (window.electronAPI?.checkStorageHealth) {
        const healthResult = await window.electronAPI.checkStorageHealth();
        log('info', `Storage health check: ${healthResult.healthy ? 'healthy' : 'unhealthy'}`);
        
        if (!healthResult.healthy) {
          log('warn', `Storage health check failed: ${healthResult.error}`);
        }
      }
      
      // Load subscription status (placeholder for future implementation)
      setState(prev => ({ ...prev, subscriptionLoaded: true }));
      
      log('info', 'User data loading completed');
      log('info', `Transitioning to DATA_LOADED state from current state: ${state.state}`);
      setState(prev => ({ 
        ...prev, 
        state: 'DATA_LOADED' as AuthStateType,
        dataLoaded: true,
        dataLoadedAt: new Date(),
        loading: false
      }));
      log('info', 'State update to DATA_LOADED completed');
    } catch (error) {
      log('error', 'User data loading failed:', error);
      setState(prev => ({ 
        ...prev, 
        error: `User data loading failed: ${error}`,
        loading: false 
      }));
      throw error;
    }
  }, []);

  // Initialize auth state manager
  const initialize = useCallback(async (): Promise<void> => {
    log('info', 'Initializing AuthStateManager');
    
    try {
      await transitionTo('CHECKING');
      await validateSession();
      
      // If authenticated, proceed with storage and data loading
      // Use a callback to get current state instead of depending on state
      setState(prev => {
        if (prev.state === 'AUTHENTICATED' && prev.userId) {
          // Schedule storage and data loading for next tick to avoid state update conflicts
          setTimeout(async () => {
            try {
              await initializeStorage(prev.userId!);
              await loadUserData();
            } catch (error) {
              log('error', 'Post-authentication initialization failed:', error);
            }
          }, 0);
        }
        return prev;
      });
    } catch (error) {
      log('error', 'AuthStateManager initialization failed:', error);
      setState(prev => ({ 
        ...prev, 
        error: `Initialization failed: ${error}`,
        loading: false 
      }));
    }
  }, []);

  // Sign out
  const signOut = useCallback(async (): Promise<void> => {
    log('info', 'Signing out user');
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      // Sign out via Electron API first
      if (window.electronAPI?.authSignOut) {
        await window.electronAPI.authSignOut();
      }
      
      // Reset state to ANONYMOUS (no storage initialization)
      const resetState = getInitialAuthState();
      resetState.state = 'ANONYMOUS';
      resetState.loading = false;
      setState(resetState);
      
      log('info', 'Sign out completed - user is now anonymous');
    } catch (error) {
      log('error', 'Sign out failed:', error);
      setState(prev => ({ 
        ...prev, 
        error: `Sign out failed: ${error}`,
        loading: false 
      }));
    }
  }, [log]);

  // Utility functions
  const isState = useCallback((stateType: AuthStateType): boolean => {
    return state.state === stateType;
  }, [state.state]);

  const canTransitionTo = useCallback((stateType: AuthStateType): boolean => {
    return isStateTransitionValid(state.state, stateType);
  }, [state.state]);

  const getStateInfo = useCallback(() => {
    return {
      current: state.state,
      allowedTransitions: VALID_TRANSITIONS[state.state] || []
    };
  }, [state.state]);

  // Error handling
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const retryLastOperation = useCallback(async (): Promise<void> => {
    if (!lastOperationRef.current) {
      throw new Error('No operation to retry');
    }
    
    if (retryCountRef.current >= finalConfig.maxRetries) {
      throw new Error('Max retries exceeded');
    }
    
    retryCountRef.current++;
    log('info', `Retrying operation (attempt ${retryCountRef.current}):`, lastOperationRef.current.type);
    
    // Retry the last operation
    switch (lastOperationRef.current.type) {
      case 'validateSession':
        await validateSession();
        break;
      case 'initializeStorage':
        if (lastOperationRef.current.params?.userId) {
          await initializeStorage(lastOperationRef.current.params.userId);
        }
        break;
      case 'loadUserData':
        await loadUserData();
        break;
      default:
        throw new Error(`Unknown operation type: ${lastOperationRef.current.type}`);
    }
    
    retryCountRef.current = 0; // Reset on success
  }, []);

  // Auto-initialize on mount (only once)
  useEffect(() => {
    const init = async () => {
      try {
        await initialize();
      } catch (error) {
        console.error('Failed to initialize AuthStateManager:', error);
      }
    };
    init();
  }, []); // Empty dependency array - only run once

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (storageSwitchTimeoutRef.current) {
        clearTimeout(storageSwitchTimeoutRef.current);
      }
    };
  }, []);

  // Context value
  const contextValue: AuthStateManagerContextType = {
    state,
    setState: (newState: Partial<AuthState>) => setState(prev => ({ ...prev, ...newState })),
    transitionTo,
    initialize,
    validateSession,
    initializeStorage,
    loadUserData,
    signOut,
    isState,
    canTransitionTo,
    getStateInfo,
    clearError,
    retryLastOperation,
    recoverFromError
  };

  return (
    <AuthStateManagerContext.Provider value={contextValue}>
      {children}
    </AuthStateManagerContext.Provider>
  );
};

// Hook to use the auth state manager
export const useAuthStateManager = (): AuthStateManagerContextType => {
  const context = useContext(AuthStateManagerContext);
  if (context === undefined) {
    throw new Error('useAuthStateManager must be used within an AuthStateManagerProvider');
  }
  return context;
};
