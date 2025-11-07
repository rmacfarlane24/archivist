import React, { useState } from 'react';
import { supabaseClient } from '../supabase-client';

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  userEmail: string;
}

export const PasswordResetModal: React.FC<PasswordResetModalProps> = ({
  isOpen,
  onClose,
  darkMode,
  userEmail
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleResetPassword = async () => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(userEmail, {
        redirectTo: window.location.origin + '/reset-password'
      });
      
      if (error) {
        setError(error.message);
      } else {
        setSuccess(true);
        // Close modal after 3 seconds
        setTimeout(() => {
          onClose();
          setSuccess(false);
        }, 3000);
      }
    } catch (err) {
      setError('Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
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
            <h2 className="text-lg font-semibold">Reset Password</h2>
            <button
              onClick={handleClose}
              disabled={loading}
              className={`text-gray-400 hover:text-gray-600 ${darkMode ? 'hover:text-gray-300' : ''} ${loading ? 'cursor-not-allowed' : ''}`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {success ? (
            <div className={`p-4 border rounded-md ${darkMode ? 'bg-blue-900 border-blue-700 text-blue-200' : 'bg-blue-100 border-blue-400 text-blue-700'}`}>
              <p className="text-sm font-medium">Password reset email sent!</p>
              <p className="text-xs mt-1">Please check your email for a password reset link.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  We'll send a password reset link to:
                </p>
                <p className={`text-sm font-medium mt-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {userEmail}
                </p>
              </div>

              <div className={`p-3 border rounded-md ${darkMode ? 'bg-yellow-900 border-yellow-700 text-yellow-200' : 'bg-yellow-100 border-yellow-400 text-yellow-700'}`}>
                <p className="text-sm">
                  <strong>Note:</strong> This will send a password reset link to your email address. 
                  You'll need to click the link in the email to set a new password.
                </p>
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
                  onClick={handleResetPassword}
                  disabled={loading}
                  className={`flex-1 px-4 py-2 rounded-md ${darkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'} text-white ${loading ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {loading ? 'Sending...' : 'Send Reset Email'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
