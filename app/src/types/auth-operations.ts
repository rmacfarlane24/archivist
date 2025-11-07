// Authentication Operations Types
// Defines all types related to authentication operations, IPC calls, and error handling

import { AuthState, AuthStateType, AuthOperation } from './auth';

// IPC Operation Types
export interface AuthIPCOperations {
  // Session management
  authGetSession: () => Promise<{ session: any; error: any }>;
  authSignIn: (email: string, password: string) => Promise<{ data: any; error: any }>;
  authSignUp: (email: string, password: string, name?: string) => Promise<{ data: any; error: any }>;
  authSignOut: () => Promise<{ error: any }>;
  authGetUser: () => Promise<{ user: any; error: any }>;
  authResetPassword: (email: string) => Promise<{ error: any }>;
  
  // Storage operations
  switchStorageUser: (userId: string | null) => Promise<{ success: boolean }>;
}

// Operation result types
export interface AuthOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  operation: AuthOperation;
  duration: number;
  timestamp: Date;
  retryCount?: number;
}

// Session validation result
export interface SessionValidationResult {
  isValid: boolean;
  session: any | null;
  user: any | null;
  error?: string;
  expiresAt?: Date;
  refreshToken?: string;
}

// Storage initialization result
export interface StorageInitResult {
  success: boolean;
  userId: string | null;
  storagePath?: string;
  error?: string;
  catalogDbPath?: string;
  driveCount?: number;
}

// User data loading result
export interface UserDataLoadResult {
  success: boolean;
  drivesLoaded: boolean;
  subscriptionLoaded: boolean;
  driveCount?: number;
  error?: string;
}

// Error types
export type AuthErrorType = 
  | 'NETWORK_ERROR'
  | 'SESSION_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'STORAGE_INIT_FAILED'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'UNKNOWN_ERROR';

export interface AuthError {
  type: AuthErrorType;
  message: string;
  code?: string;
  details?: any;
  timestamp: Date;
  operation: AuthOperation;
  retryable: boolean;
  retryCount: number;
}

// Retry configuration
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: AuthErrorType[];
}

// Operation timeout configuration
export interface TimeoutConfig {
  sessionValidation: number;
  storageInit: number;
  dataLoad: number;
  signIn: number;
  signOut: number;
}

// Operation queue types
export interface QueuedOperation {
  id: string;
  operation: AuthOperation;
  params?: any;
  priority: number;
  timestamp: Date;
  retryCount: number;
  maxRetries: number;
}

export interface OperationQueue {
  operations: QueuedOperation[];
  processing: boolean;
  currentOperation: QueuedOperation | null;
}

// State transition event types
export interface StateTransitionEvent {
  from: AuthStateType;
  to: AuthStateType;
  timestamp: Date;
  reason?: string;
  error?: string;
  operation?: AuthOperation;
  duration?: number;
}

// Performance monitoring types
export interface AuthPerformanceMetrics {
  sessionValidationTime: number;
  storageInitTime: number;
  dataLoadTime: number;
  totalInitTime: number;
  errorCount: number;
  retryCount: number;
  lastError?: AuthError;
}

// Debug and logging types
export interface AuthDebugInfo {
  currentState: AuthState;
  performanceMetrics: AuthPerformanceMetrics;
  operationHistory: AuthOperationResult[];
  errorHistory: AuthError[];
  stateTransitionHistory: StateTransitionEvent[];
  timestamp: Date;
}

// Configuration validation
export interface AuthConfigValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  config: {
    retry: RetryConfig;
    timeout: TimeoutConfig;
    features: {
      enableErrorRecovery: boolean;
      enableAutoRetry: boolean;
      enablePerformanceMonitoring: boolean;
      enableDebugLogging: boolean;
    };
  };
}

// Utility types for operation chaining
export type AuthOperationChain = AuthOperation[];

export interface OperationChainResult {
  success: boolean;
  results: AuthOperationResult[];
  totalDuration: number;
  failedOperation?: AuthOperation;
  error?: string;
}

// Event emitter types
export interface AuthEventEmitter {
  on(event: 'stateChange', listener: (event: StateTransitionEvent) => void): void;
  on(event: 'error', listener: (error: AuthError) => void): void;
  on(event: 'operationComplete', listener: (result: AuthOperationResult) => void): void;
  on(event: 'retry', listener: (operation: AuthOperation, retryCount: number) => void): void;
  
  off(event: 'stateChange', listener: (event: StateTransitionEvent) => void): void;
  off(event: 'error', listener: (error: AuthError) => void): void;
  off(event: 'operationComplete', listener: (result: AuthOperationResult) => void): void;
  off(event: 'retry', listener: (operation: AuthOperation, retryCount: number) => void): void;
  
  emit(event: 'stateChange', eventData: StateTransitionEvent): void;
  emit(event: 'error', error: AuthError): void;
  emit(event: 'operationComplete', result: AuthOperationResult): void;
  emit(event: 'retry', operation: AuthOperation, retryCount: number): void;
}

// Default configurations
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableErrors: ['NETWORK_ERROR', 'TIMEOUT']
};

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  sessionValidation: 10000,
  storageInit: 15000,
  dataLoad: 20000,
  signIn: 30000,
  signOut: 5000
};

// Utility functions for operation types
export const createAuthError = (
  type: AuthErrorType,
  message: string,
  operation: AuthOperation,
  details?: any
): AuthError => ({
  type,
  message,
  operation,
  timestamp: new Date(),
  retryable: DEFAULT_RETRY_CONFIG.retryableErrors.includes(type),
  retryCount: 0,
  details
});

export const createOperationResult = <T>(
  success: boolean,
  operation: AuthOperation,
  data?: T,
  error?: string,
  duration: number = 0
): AuthOperationResult<T> => ({
  success,
  data,
  error,
  operation,
  duration,
  timestamp: new Date()
});

export const isRetryableError = (error: AuthError): boolean => {
  return error.retryable && error.retryCount < DEFAULT_RETRY_CONFIG.maxRetries;
};

export const calculateRetryDelay = (retryCount: number): number => {
  const delay = DEFAULT_RETRY_CONFIG.baseDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, retryCount);
  return Math.min(delay, DEFAULT_RETRY_CONFIG.maxDelay);
};
