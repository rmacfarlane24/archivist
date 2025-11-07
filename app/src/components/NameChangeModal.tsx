import React, { useState } from 'react';
import { supabaseClient } from '../supabase-client';

interface NameChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentName: string;
  darkMode: boolean;
}

export const NameChangeModal: React.FC<NameChangeModalProps> = ({
  isOpen,
  onClose,
  currentName,
  darkMode
}) => {
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newName.trim()) {
      setError('Please enter a name');
      return;
    }

    if (newName === currentName) {
      setError('New name must be different from current name');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error } = await supabaseClient.auth.updateUser({
        data: { full_name: newName }
      });
      
      if (error) {
        setError(error.message);
      } else {
        setSuccess(true);
        setNewName('');
        // Close modal after 3 seconds
        setTimeout(() => {
          onClose();
          setSuccess(false);
        }, 3000);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setNewName('');
      setError(null);
      setSuccess(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className={`max-w-md w-full mx-4 rounded-lg shadow-xl ${darkMode ? 'bg-custom-black text-custom-white' : 'bg-white text-black'}`}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Change Name</h2>
            <button
              onClick={handleClose}
              disabled={loading}
              className={`text-gray-400 hover:text-gray-600 ${darkMode ? 'hover:text-gray-300' : ''} ${loading ? 'cursor-not-allowed' : ''}`}
              aria-label="Close name change dialog"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {success ? (
            <div className={`p-4 border rounded-md ${darkMode ? 'bg-green-900 border-green-700 text-green-200' : 'bg-green-100 border-green-400 text-green-700'}`}>
              <p className="text-sm font-medium">Name updated successfully!</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Current Name
                </label>
                <input
                  type="text"
                  value={currentName || 'Not set'}
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-900'}`}
                  readOnly
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  New Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter new name"
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-900'}`}
                  disabled={loading}
                />
              </div>

              {error && (
                <div className={`p-3 border rounded-md ${darkMode ? 'bg-red-900 border-red-700 text-red-200' : 'bg-red-100 border-red-400 text-red-700'}`}>
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className={`flex-1 px-4 py-2 border rounded-md ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-custom-gray' : 'border-gray-300 text-gray-700 hover:bg-gray-50'} ${loading ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className={`flex-1 px-4 py-2 rounded-md ${darkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'} text-white ${loading ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {loading ? 'Updating...' : 'Update Name'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
