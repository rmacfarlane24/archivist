// Authentication State Management Types

export type AuthStateType = 
  | 'UNINITIALIZED'
  | 'CHECKING'
  | 'ANONYMOUS'
  | 'AUTHENTICATED'
  | 'STORAGE_READY'
  | 'DATA_LOADED';

export interface AuthState {
  // Current state
  state: AuthStateType;
  
  // User information
  user: any | null;
  session: any | null;
  
  // Loading and error states
  loading: boolean;
  error: string | null;
  
  // Storage information
  storageReady: boolean;
  userId: string | null;
  storageReadyAt: Date | null;
  
  // Data loading information
  dataLoaded: boolean;
  drivesLoaded: boolean;
  subscriptionLoaded: boolean;
  driveCount: number | undefined;
  driveLoadError: string | null;
  drives: any[]; // User's drives loaded from storage
  
  // Timestamps for debugging
  lastStateChange: Date;
  sessionValidatedAt: Date | null;
  storageInitializedAt: Date | null;
  dataLoadedAt: Date | null;
}

export interface AuthStateTransition {
  from: AuthStateType;
  to: AuthStateType;
  condition?: (state: AuthState) => boolean;
  action?: (state: AuthState) => Promise<void>;
}

export interface AuthStateManagerConfig {
  // Debouncing configuration
  storageSwitchDebounceMs: number;
  
  // Retry configuration
  maxRetries: number;
  retryDelayMs: number;
  
  // Timeout configuration
  sessionValidationTimeoutMs: number;
  storageInitTimeoutMs: number;
  
  // Error handling
  enableErrorRecovery: boolean;
  enableAutoRetry: boolean;
}

export interface AuthStateManagerContextType {
  // Current state
  state: AuthState;
  
  // State management
  setState: (newState: Partial<AuthState>) => void;
  transitionTo: (newStateType: AuthStateType) => Promise<void>;
  
  // Actions
  initialize: () => Promise<void>;
  validateSession: () => Promise<void>;
  initializeStorage: (userId: string) => Promise<void>;
  loadUserData: () => Promise<void>;
  signOut: () => Promise<void>;
  
  // Utilities
  isState: (stateType: AuthStateType) => boolean;
  canTransitionTo: (stateType: AuthStateType) => boolean;
  getStateInfo: () => { current: AuthStateType; allowedTransitions: AuthStateType[] };
  
  // Error handling
  clearError: () => void;
  retryLastOperation: () => Promise<void>;
  recoverFromError: (operation: string) => Promise<void>;
}

// Event types for state changes
export interface AuthStateChangeEvent {
  previousState: AuthStateType;
  currentState: AuthStateType;
  timestamp: Date;
  reason?: string;
  error?: string;
}

export interface AuthErrorEvent {
  state: AuthStateType;
  error: string;
  timestamp: Date;
  operation: string;
  retryCount: number;
}

// Operation types
export type AuthOperation = 
  | 'initialize'
  | 'validateSession'
  | 'initializeStorage'
  | 'loadUserData'
  | 'signOut'
  | 'retryOperation';

export interface AuthOperationResult {
  success: boolean;
  operation: AuthOperation;
  duration: number;
  error?: string;
  timestamp: Date;
}

// State transition validation
export const VALID_TRANSITIONS: Record<AuthStateType, AuthStateType[]> = {
  UNINITIALIZED: ['CHECKING'],
  CHECKING: ['ANONYMOUS', 'AUTHENTICATED'],
  ANONYMOUS: ['CHECKING', 'AUTHENTICATED'],
  AUTHENTICATED: ['STORAGE_READY', 'ANONYMOUS'],
  STORAGE_READY: ['DATA_LOADED', 'AUTHENTICATED', 'ANONYMOUS'],
  DATA_LOADED: ['AUTHENTICATED', 'ANONYMOUS']
};

// State validation functions
export const isStateTransitionValid = (from: AuthStateType, to: AuthStateType): boolean => {
  return VALID_TRANSITIONS[from]?.includes(to) || false;
};

export const getInitialAuthState = (): AuthState => ({
  state: 'UNINITIALIZED',
  user: null,
  session: null,
  loading: false,
  error: null,
  storageReady: false,
  userId: null,
  storageReadyAt: null,
  dataLoaded: false,
  drivesLoaded: false,
  subscriptionLoaded: false,
  driveCount: undefined,
  driveLoadError: null,
  drives: [],
  lastStateChange: new Date(),
  sessionValidatedAt: null,
  storageInitializedAt: null,
  dataLoadedAt: null
});

// State guards
export const canPerformStorageOperation = (state: AuthState): boolean => {
  return state.state === 'STORAGE_READY' || state.state === 'DATA_LOADED';
};

export const canPerformDriveOperation = (state: AuthState): boolean => {
  return state.state === 'DATA_LOADED';
};

export const canPerformAuthOperation = (state: AuthState): boolean => {
  return state.state === 'ANONYMOUS' || state.state === 'AUTHENTICATED';
};

// Enhanced state validation functions
export const isStateComplete = (state: AuthState): boolean => {
  return state.state === 'DATA_LOADED' && 
         state.user !== null && 
         state.session !== null && 
         state.storageReady && 
         state.dataLoaded;
};

export const isStateReadyForUI = (state: AuthState): boolean => {
  return state.state === 'DATA_LOADED' || 
         state.state === 'STORAGE_READY' || 
         state.state === 'ANONYMOUS';
};

export const isStateInError = (state: AuthState): boolean => {
  return state.error !== null;
};

export const isStateLoading = (state: AuthState): boolean => {
  return state.loading || 
         state.state === 'UNINITIALIZED' || 
         state.state === 'CHECKING';
};

// State transition validation with conditions
export const validateStateTransition = (
  from: AuthStateType, 
  to: AuthStateType, 
  currentState: AuthState
): { valid: boolean; reason?: string } => {
  // Check if transition is allowed
  if (!isStateTransitionValid(from, to)) {
    return { 
      valid: false, 
      reason: `Invalid transition from ${from} to ${to}` 
    };
  }

  // Additional validation rules
  switch (to) {
    case 'AUTHENTICATED':
      if (!currentState.user || !currentState.session) {
        return { 
          valid: false, 
          reason: 'Cannot transition to AUTHENTICATED without user and session' 
        };
      }
      break;
    
    case 'STORAGE_READY':
      if (!currentState.userId) {
        return { 
          valid: false, 
          reason: 'Cannot transition to STORAGE_READY without userId' 
        };
      }
      break;
    
    case 'DATA_LOADED':
      if (!currentState.storageReady) {
        return { 
          valid: false, 
          reason: 'Cannot transition to DATA_LOADED without storage ready' 
        };
      }
      break;
  }

  return { valid: true };
};

// State comparison utilities
export const hasStateChanged = (oldState: AuthState, newState: AuthState): boolean => {
  return oldState.state !== newState.state ||
         oldState.userId !== newState.userId ||
         oldState.loading !== newState.loading ||
         oldState.error !== newState.error ||
         oldState.storageReady !== newState.storageReady ||
         oldState.dataLoaded !== newState.dataLoaded;
};

export const getStateChangeSummary = (oldState: AuthState, newState: AuthState): string => {
  const changes: string[] = [];
  
  if (oldState.state !== newState.state) {
    changes.push(`State: ${oldState.state} → ${newState.state}`);
  }
  
  if (oldState.userId !== newState.userId) {
    changes.push(`User: ${oldState.userId || 'none'} → ${newState.userId || 'none'}`);
  }
  
  if (oldState.loading !== newState.loading) {
    changes.push(`Loading: ${oldState.loading} → ${newState.loading}`);
  }
  
  if (oldState.error !== newState.error) {
    changes.push(`Error: ${oldState.error || 'none'} → ${newState.error || 'none'}`);
  }
  
  if (oldState.storageReady !== newState.storageReady) {
    changes.push(`Storage: ${oldState.storageReady} → ${newState.storageReady}`);
  }
  
  if (oldState.dataLoaded !== newState.dataLoaded) {
    changes.push(`Data: ${oldState.dataLoaded} → ${newState.dataLoaded}`);
  }
  
  return changes.join(', ');
};

// State debugging utilities
export const getStateDebugInfo = (state: AuthState): Record<string, any> => {
  return {
    currentState: state.state,
    userId: state.userId,
    loading: state.loading,
    error: state.error,
    storageReady: state.storageReady,
    dataLoaded: state.dataLoaded,
    drivesLoaded: state.drivesLoaded,
    subscriptionLoaded: state.subscriptionLoaded,
    timestamps: {
      lastStateChange: state.lastStateChange.toISOString(),
      sessionValidatedAt: state.sessionValidatedAt?.toISOString() || null,
      storageInitializedAt: state.storageInitializedAt?.toISOString() || null,
      dataLoadedAt: state.dataLoadedAt?.toISOString() || null
    },
    allowedTransitions: VALID_TRANSITIONS[state.state] || []
  };
};

// State serialization utilities
export const serializeAuthState = (state: AuthState): string => {
  return JSON.stringify({
    ...state,
    lastStateChange: state.lastStateChange.toISOString(),
    sessionValidatedAt: state.sessionValidatedAt?.toISOString() || null,
    storageInitializedAt: state.storageInitializedAt?.toISOString() || null,
    dataLoadedAt: state.dataLoadedAt?.toISOString() || null
  });
};

export const deserializeAuthState = (serialized: string): AuthState => {
  const parsed = JSON.parse(serialized);
  return {
    ...parsed,
    lastStateChange: new Date(parsed.lastStateChange),
    sessionValidatedAt: parsed.sessionValidatedAt ? new Date(parsed.sessionValidatedAt) : null,
    storageInitializedAt: parsed.storageInitializedAt ? new Date(parsed.storageInitializedAt) : null,
    dataLoadedAt: parsed.dataLoadedAt ? new Date(parsed.dataLoadedAt) : null
  };
};
