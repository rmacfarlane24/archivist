import React from 'react';
import { useAuthStateManager } from '../contexts/AuthStateManager';
import { useAuthErrorRecovery } from '../contexts/AuthContext';
import { AuthStateType } from '../types/auth';

export const AuthStateDebugger: React.FC = () => {
  const { state, getStateInfo } = useAuthStateManager();
  const { clearError, retryLastOperation, recoverFromError, canRecover, canRetry } = useAuthErrorRecovery();
  
  const stateInfo = getStateInfo();
  
  const getStateColor = (stateType: AuthStateType): string => {
    switch (stateType) {
      case 'UNINITIALIZED': return 'bg-gray-500';
      case 'CHECKING': return 'bg-yellow-500';
      case 'ANONYMOUS': return 'bg-red-500';
      case 'AUTHENTICATED': return 'bg-blue-500';
      case 'STORAGE_READY': return 'bg-green-500';
      case 'DATA_LOADED': return 'bg-emerald-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-4 max-w-sm z-50">
      <h3 className="text-sm font-semibold mb-2 text-gray-900 dark:text-white">
        Auth State Debugger
      </h3>
      
      {/* Current State */}
      <div className="mb-3">
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Current State:</div>
        <div className={`inline-block px-2 py-1 rounded text-xs text-white ${getStateColor(state.state)}`}>
          {state.state}
        </div>
      </div>
      
      {/* State Details */}
      <div className="text-xs space-y-1 mb-3">
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Loading:</span>
          <span className={state.loading ? 'text-yellow-600' : 'text-green-600'}>
            {state.loading ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">User ID:</span>
          <span className="text-gray-900 dark:text-white">
            {state.userId || 'None'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Storage Ready:</span>
          <span className={state.storageReady ? 'text-green-600' : 'text-red-600'}>
            {state.storageReady ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Data Loaded:</span>
          <span className={state.dataLoaded ? 'text-green-600' : 'text-red-600'}>
            {state.dataLoaded ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Drive Count:</span>
          <span className="text-gray-900 dark:text-white">
            {state.driveCount !== undefined ? state.driveCount : 'Unknown'}
          </span>
        </div>
        {state.driveLoadError && (
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Drive Error:</span>
            <span className="text-red-600 dark:text-red-400 text-xs">
              {state.driveLoadError}
            </span>
          </div>
        )}
      </div>
      
      {/* Allowed Transitions */}
      <div className="mb-3">
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Allowed Transitions:</div>
        <div className="flex flex-wrap gap-1">
          {stateInfo.allowedTransitions.map((transition) => (
            <div
              key={transition}
              className={`px-2 py-1 rounded text-xs text-white ${getStateColor(transition)}`}
            >
              {transition}
            </div>
          ))}
        </div>
      </div>
      
      {/* Error Display */}
      {state.error && (
        <div className="mb-3">
          <div className="text-xs text-red-600 dark:text-red-400 mb-1">Error:</div>
          <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-2 rounded">
            {state.error}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={clearError}
              className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-custom-gray"
            >
              Clear Error
            </button>
            {canRetry && (
              <button
                onClick={retryLastOperation}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Retry
              </button>
            )}
            {canRecover && (
              <button
                onClick={() => recoverFromError('storage-operation')}
                className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
              >
                Recover
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Timestamps */}
      <div className="text-xs space-y-1">
        <div className="text-gray-600 dark:text-gray-400 mb-1">Timestamps:</div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Last Change:</span>
            <span className="text-gray-900 dark:text-white">
              {state.lastStateChange.toLocaleTimeString()}
            </span>
          </div>
          {state.sessionValidatedAt && (
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Session Validated:</span>
              <span className="text-gray-900 dark:text-white">
                {state.sessionValidatedAt.toLocaleTimeString()}
              </span>
            </div>
          )}
          {state.storageInitializedAt && (
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Storage Ready:</span>
              <span className="text-gray-900 dark:text-white">
                {state.storageInitializedAt.toLocaleTimeString()}
              </span>
            </div>
          )}
          {state.dataLoadedAt && (
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Data Loaded:</span>
              <span className="text-gray-900 dark:text-white">
                {state.dataLoadedAt.toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
