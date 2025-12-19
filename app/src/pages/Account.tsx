import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { PlanSelection } from '../components/PlanSelection';
import { NameChangeModal } from '../components/NameChangeModal';
import { EmailChangeModal } from '../components/EmailChangeModal';
import { PasswordChangeModal } from '../components/PasswordChangeModal';

import { DarkModePreference } from '../hooks/useDarkMode';

interface AccountProps {
  darkMode: boolean;
  setDarkMode: (darkMode: boolean) => void;
  preference?: 'light' | 'dark' | 'system';
  setPreference?: (pref: 'light' | 'dark' | 'system') => void;
  onSignOut: () => void;
  onBack: () => void;
}

export const Account: React.FC<AccountProps> = ({ darkMode, setDarkMode, preference = 'system', setPreference, onSignOut, onBack }) => {
  const { user, session } = useAuth();
  const { userSubscription } = useSubscription();
  
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState(false);
  
  // Update checker state
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'no-update' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  // NEW PAYMENT SYSTEM - Active
  const handlePlanSelected = async () => {
    // This is now handled in the PlanSelection component
    // Just close the modal
    setIsPlanModalOpen(false);
  };

  // Get current app version and check for latest version on component mount
  useEffect(() => {
    const initializeVersionInfo = async () => {
      // Get current version
      if (window.electronAPI?.getAppVersion) {
        try {
          const version = await window.electronAPI.getAppVersion();
          setCurrentVersion(version);
        } catch (error) {
          console.error('Error getting app version:', error);
        }
      }
      
      // Auto-check for latest version
      if (window.electronAPI?.updaterCheckForUpdates) {
        try {
          console.log('Fetching latest version from GitHub...');
          const result = await window.electronAPI.updaterCheckForUpdates();
          console.log('Update check result:', result);
          
          // Always set the latest version info
          if (result.version) {
            setUpdateInfo({ version: result.version });
          }
          
          // Set status based on availability
          if (result.available) {
            setUpdateStatus('available');
          } else {
            setUpdateStatus('no-update');
          }
        } catch (error) {
          console.error('Error checking for latest version:', error);
          setUpdateStatus('error');
        }
      }
    };
    initializeVersionInfo();
  }, []);

  // Update checker handlers
  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.updaterCheckForUpdates) {
      setUpdateStatus('error');
      return;
    }
    
    setUpdateStatus('checking');
    try {
      const result = await window.electronAPI.updaterCheckForUpdates();
      if (result.available) {
        setUpdateStatus('available');
        setUpdateInfo({ version: result.version });
      } else {
        setUpdateStatus('no-update');
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      setUpdateStatus('error');
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.electronAPI?.updaterDownloadUpdate) return;
    
    setUpdateStatus('downloading');
    try {
      const result = await window.electronAPI.updaterDownloadUpdate();
      if (result.success) {
        setUpdateStatus('ready');
      } else {
        console.error('Download failed:', result.error || result.message);
        // In development mode, redirect to GitHub
        if (result.message?.includes('development')) {
          if (updateInfo?.version && window.electronAPI?.openExternal) {
            const downloadUrl = `https://github.com/rmacfarlane24/archivist/releases/tag/v${updateInfo.version}`;
            await window.electronAPI.openExternal(downloadUrl);
          }
        }
        setUpdateStatus('error');
      }
    } catch (error) {
      console.error('Error downloading update:', error);
      setUpdateStatus('error');
    }
  };

  const handleInstallUpdate = async () => {
    if (!window.electronAPI?.updaterInstallUpdate) return;
    
    try {
      const result = await window.electronAPI.updaterInstallUpdate();
      if (!result.success) {
        console.error('Install failed:', result.error || result.message);
        setUpdateStatus('error');
      }
      // If successful, the app will quit and restart - no need to update status
    } catch (error) {
      console.error('Error installing update:', error);
      setUpdateStatus('error');
    }
  };

  // Customer Portal - Manage Billing
  const handleManageBilling = async () => {
    if (!userSubscription?.stripeCustomerId) {
      console.error('No Stripe customer ID available');
      return;
    }

    try {
      const sessionToken = session?.access_token;
      
      if (!sessionToken) {
        throw new Error('No valid session token available');
      }
      
      const response = await fetch('https://xslphflkpeyfqcwwlrih.supabase.co/functions/v1/create-portal-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          customerId: userSubscription.stripeCustomerId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to create portal session: ${errorData.error || 'Unknown error'}`);
      }

      const data = await response.json();
      
      if (data.success && data.portal_url) {
        window.open(data.portal_url, '_blank');
      } else {
        throw new Error('Invalid response from portal function');
      }
    } catch (error) {
      console.error('Portal error:', error);
      // You might want to show an error message to the user
    }
  };

  // LEGACY PAYMENT SYSTEM - Removed (all checkout functionality now handled in PlanSelection component)

  if (!user) {
    return <div>Loading...</div>;
  }

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-custom-gray text-custom-white' : 'bg-gray-100 text-black'}`}>
      {/* Content */}
      <div className="p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Profile Section */}
          <div className={`p-6 rounded-lg shadow-sm ${darkMode ? 'bg-custom-black' : 'bg-custom-white'}`}>
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={onBack}
                className={`p-1 rounded ${darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-xl font-medium">Account</h1>
              <div className="w-6"></div>
            </div>
            <h2 className="text-lg font-medium mb-4">Profile</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3 group">
                <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Name:
                </span>
                <div className="flex items-center gap-2 flex-1">
                  <span className={`${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {user.user_metadata?.full_name || 'Not set'}
                  </span>
                  <button
                    onClick={() => setIsNameModalOpen(true)}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-3 group">
                <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Email:
                </span>
                <div className="flex items-center gap-2 flex-1">
                  <span className={`${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {user.email || ''}
                  </span>
                  <button
                    onClick={() => setIsEmailModalOpen(true)}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-3 group">
                <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Password:
                </span>
                <div className="flex items-center gap-2 flex-1">
                  <span className={`${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    ••••••••
                  </span>
                  <button
                    onClick={() => setIsPasswordModalOpen(true)}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Billing Section */}
          <div className={`p-6 rounded-lg shadow-sm ${darkMode ? 'bg-custom-black' : 'bg-custom-white'}`}>
            <h2 className="text-lg font-medium mb-4">Billing & Subscription</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Current Plan</span>
                <div className="flex flex-col items-end gap-1">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-800'}`}>
                    {userSubscription?.plan === 'free' ? 'Free Trial' : userSubscription?.plan || 'Free Trial'}
                  </span>
                  
                  {/* Plan Expiration/Renewal Info */}
                  {userSubscription?.plan === 'free' && userSubscription?.trialEndsAt && (
                    <div className="text-xs text-red-500 text-right">
                      <span>
                        Trial expires: {userSubscription.trialEndsAt.toLocaleDateString()} 
                        ({Math.max(0, Math.ceil((userSubscription.trialEndsAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))} days remaining)
                      </span>
                    </div>
                  )}
                  
                  {userSubscription?.plan && userSubscription.plan !== 'free' && userSubscription.plan !== 'lifetime' && (
                    <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'} text-right`}>
                      {userSubscription.subscriptionEndsAt ? (
                        <span>
                          Auto-renews {userSubscription.subscriptionEndsAt.toLocaleDateString()}
                        </span>
                      ) : (
                        <span>Subscription active</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="pt-2 space-y-2">
                <div className="flex justify-end gap-2">
                  {/* Show Select Plan only for trial users */}
                  {userSubscription?.plan === 'free' && (
                    <button
                      onClick={() => setIsPlanModalOpen(true)}
                      className={`text-sm px-4 py-2 rounded font-medium ${darkMode ? 'bg-gray-700 hover:bg-custom-gray' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                    >
                      Select Plan
                    </button>
                  )}
                  
                  {/* Show Manage Billing only for subscribers (not lifetime) */}
                  {userSubscription?.stripeCustomerId && userSubscription?.plan !== 'free' && userSubscription?.plan !== 'lifetime' && (
                    <button
                      onClick={handleManageBilling}
                      className={`text-sm px-3 py-2 rounded ${darkMode ? 'bg-gray-700 hover:bg-custom-gray' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                    >
                      Manage Billing
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Appearance Section */}
          <div className={`p-6 rounded-lg shadow-sm ${darkMode ? 'bg-custom-black' : 'bg-custom-white'}`}>
            <h2 className="text-lg font-medium mb-4">Appearance</h2>
            <div className="space-y-4">
              <div className="space-y-3">
                <span className="text-sm">Theme</span>
                <div className="space-y-2">
                  {(['light', 'dark', 'system'] as DarkModePreference[]).map((option) => (
                    <label key={option} className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="theme"
                        value={option}
                        checked={option === preference}
                        onChange={() => {
                          if (setPreference) {
                            setPreference(option);
                          } else {
                            // Fallback to old system
                            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                            if (option === 'system') {
                              setDarkMode(systemPrefersDark);
                            } else {
                              setDarkMode(option === 'dark');
                            }
                          }
                        }}
                        className="text-gray-400"
                      />
                      <span className="text-sm capitalize">
                        {option === 'system' ? 'Use System Setting' : option}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* App Updates Section */}
          <div className={`p-6 rounded-lg shadow-sm ${darkMode ? 'bg-custom-black' : 'bg-custom-white'}`}>
            <h2 className="text-lg font-medium mb-4">App Updates</h2>
            
            {/* Version Information */}
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex justify-between items-center text-sm">
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">Current Version:</span>
                  <span className="ml-2 text-gray-900 dark:text-gray-100">{currentVersion || 'Loading...'}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">Latest Version:</span>
                  <span className="ml-2 text-gray-900 dark:text-gray-100">{updateInfo?.version || 'Checking...'}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">
                    {updateStatus === 'checking' && 'Checking for updates...'}
                    {updateStatus === 'available' && (
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">Update available: v{updateInfo?.version}</span>
                      </div>
                    )}
                    {updateStatus === 'downloading' && 'Downloading update...'}
                    {updateStatus === 'ready' && 'Update ready to install'}
                    {updateStatus === 'no-update' && 'You have the latest version'}
                    {updateStatus === 'error' && 'Error checking for updates'}
                  </div>
                </div>
                <div className="flex gap-2">
                  {updateStatus === 'idle' && (
                    <button
                      onClick={handleCheckForUpdates}
                      className={`px-4 py-2 text-sm rounded font-medium ${
                        darkMode 
                          ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      Check for Updates
                    </button>
                  )}
                  
                  {updateStatus === 'available' && (
                    <button
                      onClick={handleDownloadUpdate}
                      className={`px-4 py-2 text-sm rounded font-medium ${
                        darkMode 
                          ? 'bg-green-600 hover:bg-green-700 text-white' 
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      Update Now
                    </button>
                  )}
                  
                  {updateStatus === 'downloading' && (
                    <button
                      disabled
                      className="px-4 py-2 text-sm rounded font-medium bg-gray-400 text-white cursor-not-allowed"
                    >
                      Downloading...
                    </button>
                  )}
                  
                  {updateStatus === 'ready' && (
                    <button
                      onClick={handleInstallUpdate}
                      className={`px-4 py-2 text-sm rounded font-medium ${
                        darkMode 
                          ? 'bg-orange-600 hover:bg-orange-700 text-white' 
                          : 'bg-orange-600 hover:bg-orange-700 text-white'
                      }`}
                    >
                      Install & Restart
                    </button>
                  )}
                  
                  {(updateStatus === 'no-update' || updateStatus === 'error') && (
                    <button
                      onClick={handleCheckForUpdates}
                      className={`px-4 py-2 text-sm rounded font-medium ${
                        darkMode 
                          ? 'bg-gray-600 hover:bg-gray-700 text-white' 
                          : 'bg-gray-600 hover:bg-gray-700 text-white'
                      }`}
                    >
                      Check Again
                    </button>
                  )}
                  
                  {updateStatus === 'checking' && (
                    <div className="flex items-center px-4 py-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                    </div>
                  )}
                  
                  {updateStatus === 'downloading' && (
                    <div className="flex items-center px-4 py-2">
                      <div className="animate-pulse text-sm">Downloading...</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sign Out Section */}
          <div className={`p-6 rounded-lg shadow-sm ${darkMode ? 'bg-custom-black' : 'bg-custom-white'}`}>
            <div className="flex justify-center">
              <button
                onClick={() => setIsSignOutModalOpen(true)}
                className="text-red-600 hover:underline text-sm"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Plan Selection Modal */}
      <PlanSelection
        isOpen={isPlanModalOpen}
        onClose={() => setIsPlanModalOpen(false)}
        onPlanSelected={handlePlanSelected}
      />

      {/* Name Change Modal */}
      <NameChangeModal
        isOpen={isNameModalOpen}
        onClose={() => setIsNameModalOpen(false)}
        currentName={user.user_metadata?.full_name || ''}
        darkMode={darkMode}
      />

      {/* Email Change Modal */}
      <EmailChangeModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        currentEmail={user.email || ''}
        darkMode={darkMode}
      />

      {/* Password Change Modal */}
      <PasswordChangeModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        darkMode={darkMode}
        userEmail={user.email || ''}
      />

      {/* Sign Out Confirmation Modal */}
      {isSignOutModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-50">
          <div className={`p-6 rounded-lg shadow-xl max-w-md w-full mx-4 ${darkMode ? 'bg-custom-black text-custom-white' : 'bg-custom-white text-gray-900'}`}>
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-4">Sign Out</h3>
              <p className={`text-sm mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Are you sure you want to sign out?
              </p>
              <div className="flex justify-center space-x-3">
                <button
                  onClick={() => setIsSignOutModalOpen(false)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    darkMode 
                      ? 'bg-gray-600 hover:bg-custom-gray text-white' 
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setIsSignOutModalOpen(false);
                    onSignOut();
                  }}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    darkMode 
                      ? 'bg-gray-600 hover:bg-custom-gray text-red-400' 
                      : 'bg-gray-200 hover:bg-gray-300 text-red-600'
                  }`}
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
