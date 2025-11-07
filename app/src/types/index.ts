// Authentication Types Index
// Central export point for all authentication-related types

// Core auth types
export * from './auth';

// Operation types
export * from './auth-operations';

// Re-export commonly used types for convenience
export type {
  AuthState,
  AuthStateType,
  AuthStateManagerContextType,
  AuthStateManagerConfig,
  AuthOperation,
  AuthError,
  AuthErrorType,
  SessionValidationResult,
  StorageInitResult,
  UserDataLoadResult,
  RetryConfig,
  TimeoutConfig
} from './auth';

export type {
  AuthIPCOperations,
  AuthOperationResult,
  QueuedOperation,
  OperationQueue,
  StateTransitionEvent,
  AuthPerformanceMetrics,
  AuthDebugInfo,
  AuthConfigValidation,
  AuthOperationChain,
  OperationChainResult,
  AuthEventEmitter
} from './auth-operations';

// Re-export utility functions
export {
  isStateTransitionValid,
  getInitialAuthState,
  canPerformStorageOperation,
  canPerformDriveOperation,
  canPerformAuthOperation,
  isStateComplete,
  isStateReadyForUI,
  isStateInError,
  isStateLoading,
  validateStateTransition,
  hasStateChanged,
  getStateChangeSummary,
  getStateDebugInfo,
  serializeAuthState,
  deserializeAuthState,
  VALID_TRANSITIONS
} from './auth';

export {
  createAuthError,
  createOperationResult,
  isRetryableError,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_CONFIG
} from './auth-operations';
