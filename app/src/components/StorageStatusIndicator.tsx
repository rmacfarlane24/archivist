import React from 'react';
import { useAuthStorage } from '../contexts/AuthContext';

export const StorageStatusIndicator: React.FC = () => {
  const { 
    storageReady, 
    driveCount, 
    driveLoadError, 
    hasDrives, 
    hasDriveError,
    isStorageReady 
  } = useAuthStorage();

  if (!storageReady) {
    return (
      <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
        <span>Initializing storage...</span>
      </div>
    );
  }

  if (hasDriveError) {
    return (
      <div className="flex items-center space-x-2 text-sm text-red-600 dark:text-red-400">
        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
        <span>Storage warning</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          ({driveLoadError})
        </span>
      </div>
    );
  }

  if (hasDrives) {
    return (
      <div className="flex items-center space-x-2 text-sm text-green-600 dark:text-green-400">
        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        <span>Storage ready</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          ({driveCount} drive{driveCount !== 1 ? 's' : ''})
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
      <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
      <span>No drives found</span>
    </div>
  );
};

// Compact version for use in headers or status bars
export const CompactStorageStatus: React.FC = () => {
  const { storageReady, hasDrives, hasDriveError } = useAuthStorage();

  if (!storageReady) {
    return (
      <div className="flex items-center space-x-1">
        <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></div>
        <span className="text-xs text-gray-600 dark:text-gray-400">Storage</span>
      </div>
    );
  }

  if (hasDriveError) {
    return (
      <div className="flex items-center space-x-1">
        <div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div>
        <span className="text-xs text-red-600 dark:text-red-400">Storage</span>
      </div>
    );
  }

  if (hasDrives) {
    return (
      <div className="flex items-center space-x-1">
        <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
        <span className="text-xs text-green-600 dark:text-green-400">Storage</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-1">
      <div className="w-1.5 h-1.5 bg-gray-500 rounded-full"></div>
      <span className="text-xs text-gray-600 dark:text-gray-400">Storage</span>
    </div>
  );
};
