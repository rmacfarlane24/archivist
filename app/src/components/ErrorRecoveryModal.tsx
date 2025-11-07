import React, { useState } from 'react';
import { useAuthErrorRecovery } from '../contexts/AuthContext';

interface ErrorRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ErrorRecoveryModal: React.FC<ErrorRecoveryModalProps> = ({ isOpen, onClose }) => {
  const { error, hasError, canRecover, canRetry, recoverFromError, retryLastOperation, clearError } = useAuthErrorRecovery();
  const [isRecovering, setIsRecovering] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  if (!isOpen || !hasError) return null;

  const handleRecover = async () => {
    setIsRecovering(true);
    try {
      await recoverFromError('storage-operation');
      onClose();
    } catch (error) {
      console.error('Recovery failed:', error);
    } finally {
      setIsRecovering(false);
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await retryLastOperation();
      onClose();
    } catch (error) {
      console.error('Retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleClearError = () => {
    clearError();
    onClose();
  };

  const getErrorMessage = (error: string): string => {
    if (error.includes('Storage')) {
      return 'There was an issue with your storage. This can usually be resolved automatically.';
    }
    if (error.includes('Authentication')) {
      return 'There was an issue with your authentication. Please try signing in again.';
    }
    if (error.includes('Network')) {
      return 'There was a network connection issue. Please check your internet connection.';
    }
    return 'An unexpected error occurred. Please try again.';
  };

  const getRecoveryMessage = (error: string): string => {
    if (error.includes('Storage')) {
      return 'This will attempt to recover your storage and reload your data.';
    }
    if (error.includes('Authentication')) {
      return 'This will attempt to refresh your authentication session.';
    }
    return 'This will attempt to resolve the issue automatically.';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative p-6 rounded-lg shadow-xl max-w-md w-full mx-4 bg-custom-white text-custom-black dark:bg-gray-800 dark:text-white">
        <h3 className="text-lg font-semibold mb-2 text-red-600 dark:text-red-400">
          Error Recovery
        </h3>
        
        <div className="mb-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            {getErrorMessage(error || '')}
          </p>
          
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-3 rounded">
            <strong>Technical Details:</strong>
            <br />
            {error}
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          {canRecover && (
            <button
              onClick={handleRecover}
              disabled={isRecovering}
              className="px-4 py-2 text-sm rounded bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRecovering ? 'Recovering...' : 'Recover Automatically'}
            </button>
          )}
          
          {canRetry && (
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="px-4 py-2 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRetrying ? 'Retrying...' : 'Retry Operation'}
            </button>
          )}
          
          <button
            onClick={handleClearError}
            className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-600 dark:text-white dark:hover:bg-custom-gray"
          >
            Dismiss Error
          </button>
        </div>

        {canRecover && (
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            <strong>Recovery:</strong> {getRecoveryMessage(error || '')}
          </div>
        )}
      </div>
    </div>
  );
};
