import React, { useState, useRef, useEffect } from 'react';
import { supabaseClient } from '../supabase-client';

interface PasswordChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  userEmail: string;
}

export const PasswordChangeModal: React.FC<PasswordChangeModalProps> = ({
  isOpen,
  onClose,
  darkMode,
  userEmail
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus management and keyboard handling
  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const validatePassword = (password: string) => {
    if (password.length < 6) {
      return 'Password must be at least 6 characters long';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentPassword.trim()) {
      setError('Please enter your current password');
      return;
    }

    if (!newPassword.trim()) {
      setError('Please enter a new password');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
      
      if (error) {
        setError(error.message);
      } else {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
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
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setSuccess(false);
      setResetEmailSent(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div 
        ref={modalRef}
        className={`max-w-md w-full mx-4 rounded-lg shadow-xl ${darkMode ? 'bg-custom-black text-custom-white' : 'bg-custom-white text-custom-black'}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-change-title"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 id="password-change-title" className="text-lg font-semibold">Change Password</h2>
            <button
              onClick={handleClose}
              disabled={loading}
              className={`text-gray-400 hover:text-gray-600 ${darkMode ? 'hover:text-gray-300' : ''} ${loading ? 'cursor-not-allowed' : ''}`}
              aria-label="Close password change dialog"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {success ? (
            <div 
              className={`p-4 border rounded-md ${darkMode ? 'bg-green-900 border-green-700 text-green-200' : 'bg-green-100 border-green-400 text-green-700'}`}
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-medium">Password updated successfully!</p>
            </div>
          ) : resetEmailSent ? (
            <div 
              className={`p-4 border rounded-md ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-blue-100 border-blue-400 text-blue-700'}`}
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-medium">Password reset email sent!</p>
              <p className="text-xs mt-1">Please check your email for a password reset link.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-custom-white text-custom-black'}`}
                  disabled={loading}
                />
                <div className="mt-1 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setLoading(true);
                        const { error } = await supabaseClient.auth.resetPasswordForEmail(userEmail, {
                          redirectTo: window.location.origin + '/reset-password'
                        });
                        
                        if (error) {
                          setError(error.message);
                        } else {
                          setResetEmailSent(true);
                          // Close modal after 3 seconds
                          setTimeout(() => {
                            onClose();
                            setResetEmailSent(false);
                          }, 3000);
                        }
                      } catch (err) {
                        setError('Failed to send reset email');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className={`text-xs ${darkMode ? 'text-gray-300 hover:text-gray-200' : 'text-blue-600 hover:text-blue-700'}`}
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-custom-white text-custom-black'}`}
                  disabled={loading}
                  aria-describedby={`password-help${error ? ' password-error' : ''}`}
                />
                <p id="password-help" className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Must be at least 6 characters long
                </p>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-custom-white text-custom-black'}`}
                  disabled={loading}
                />
              </div>

              {error && (
                <div 
                  id="password-error"
                  className={`p-3 border rounded-md ${darkMode ? 'bg-red-900 border-red-700 text-red-200' : 'bg-red-100 border-red-400 text-red-700'}`}
                  role="alert"
                >
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
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
