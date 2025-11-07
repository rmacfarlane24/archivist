import React, { useState } from 'react';
import { supabaseClient } from '../supabase-client';

interface EmailChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEmail: string;
  darkMode: boolean;
}

export const EmailChangeModal: React.FC<EmailChangeModalProps> = ({
  isOpen,
  onClose,
  currentEmail,
  darkMode
}) => {
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newEmail.trim()) {
      setError('Please enter a new email address');
      return;
    }

    if (newEmail === currentEmail) {
      setError('New email must be different from current email');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error } = await supabaseClient.auth.updateUser({ email: newEmail });
      
      if (error) {
        setError(error.message);
      } else {
        setSuccess(true);
        setNewEmail('');
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
      setNewEmail('');
      setError(null);
      setSuccess(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className={`max-w-md w-full mx-4 rounded-lg shadow-xl ${darkMode ? 'bg-custom-black text-custom-white' : 'bg-custom-white text-custom-black'}`}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Change Email Address</h2>
            <button
              onClick={handleClose}
              disabled={loading}
              className={`text-gray-400 hover:text-gray-600 ${darkMode ? 'hover:text-gray-300' : ''} ${loading ? 'cursor-not-allowed' : ''}`}
              aria-label="Close email change dialog"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {success ? (
            <div className={`p-4 border rounded-md ${darkMode ? 'bg-green-900 border-green-700 text-green-200' : 'bg-green-100 border-green-400 text-green-700'}`}>
              <p className="text-sm font-medium">Email change request sent!</p>
              <p className="text-xs mt-1">Please check your new email address for a confirmation link.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Current Email
                </label>
                <input
                  type="email"
                  value={currentEmail}
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-custom-white text-custom-black'}`}
                  readOnly
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  New Email Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Enter new email address"
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-custom-white text-custom-black'}`}
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
                  className={`flex-1 px-4 py-2 rounded-md ${darkMode ? 'bg-gray-700 hover:bg-custom-gray' : 'bg-blue-600 hover:bg-blue-700'} text-white ${loading ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {loading ? 'Updating...' : 'Update Email'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
