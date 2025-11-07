import React, { useState } from 'react';

interface BackupInfo {
  id: string;
  type: 'drive' | 'catalog';
  driveId?: string;
  driveName?: string;
  timestamp: number;
  size: number;
  path: string;
}

interface RestoreConfirmationProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  backup: BackupInfo | null;
  darkMode: boolean;
  isRestoring: boolean;
}

export const RestoreConfirmation: React.FC<RestoreConfirmationProps> = ({
  isOpen,
  onClose,
  onConfirm,
  backup,
  darkMode,
  isRestoring
}) => {
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !backup) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    onConfirm();
  };

  const handleClose = () => {
    if (!isRestoring) {
      setError(null);
      onClose();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getBackupTypeLabel = () => {
    return backup.type === 'drive' ? 'Drive Backup' : 'Catalog Backup';
  };

  const getBackupName = () => {
    if (backup.type === 'drive') {
      return backup.driveName || `Drive ${backup.driveId}`;
    }
    return 'Catalog Backup';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className={`relative p-6 rounded-lg shadow-xl max-w-md w-full mx-4 ${darkMode ? 'bg-custom-black text-custom-white' : 'bg-white text-black'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Confirm Restore</h2>
          <button
            onClick={handleClose}
            disabled={isRestoring}
            className={`text-gray-400 hover:text-gray-600 ${darkMode ? 'hover:text-gray-300' : ''} ${isRestoring ? 'cursor-not-allowed' : ''}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <div className={`p-4 rounded-lg border ${darkMode ? 'border-gray-600 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="font-medium">{getBackupName()}</h3>
              <span className={`px-2 py-1 rounded text-xs font-medium ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-200 text-gray-800'}`}>
                {getBackupTypeLabel()}
              </span>
            </div>
            <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <p>Created: {new Date(backup.timestamp).toLocaleString()}</p>
              <p>Size: {formatFileSize(backup.size)}</p>
            </div>
          </div>

          <div className={`mt-4 p-4 rounded-lg ${darkMode ? 'bg-gray-800 border border-gray-600' : 'bg-blue-50 border border-blue-200'}`}>
            <div className="flex items-start space-x-3">
              <svg className={`w-5 h-5 ${darkMode ? 'text-gray-300' : 'text-blue-500'} mt-0.5`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div>
                <h4 className={`font-medium ${darkMode ? 'text-gray-200' : 'text-blue-800'}`}>
                  Original Drive Restore
                </h4>
                <p className={`text-sm mt-1 ${darkMode ? 'text-gray-300' : 'text-blue-700'}`}>
                  This will restore the drive with its original ID and name. 
                  All original data and metadata will be preserved.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className={`mt-3 p-3 rounded-md ${darkMode ? 'bg-red-900 border border-red-700' : 'bg-red-50 border border-red-200'}`}>
              <p className={`text-sm ${darkMode ? 'text-red-200' : 'text-red-800'}`}>{error}</p>
            </div>
          )}
        </div>

        <div className="flex space-x-3">
          <button
            onClick={handleClose}
            disabled={isRestoring}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              darkMode 
                ? 'bg-gray-700 hover:bg-custom-gray text-gray-200' 
                : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
            } ${isRestoring ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isRestoring}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              isRestoring
                ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                : (darkMode ? 'bg-gray-700 hover:bg-custom-gray text-white' : 'bg-blue-600 hover:bg-blue-700 text-white')
            }`}
          >
            {isRestoring ? 'Restoring...' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  );
};
