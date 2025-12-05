import { useState, useEffect } from 'react';
import { useAuthEnhanced, useAuthErrorRecovery } from './contexts/AuthContext';
import { useSubscription } from './contexts/SubscriptionContext';
import { ErrorRecoveryModal } from './components/ErrorRecoveryModal';
import { StorageStatusIndicator } from './components/StorageStatusIndicator';
import SubscriptionGuard from './components/SubscriptionGuard';
import App from './App';

interface AuthWrapperProps {
  darkMode: boolean;
  setDarkMode: (darkMode: boolean) => void;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ darkMode }) => {
  const { 
    loading, 
    signOut, 
    isDataLoaded,
    hasError,
    state
  } = useAuthEnhanced();
  
  // Note: Removed subscriptionLoading dependency as SubscriptionGuard handles its own loading
  const { canRecover, canRetry } = useAuthErrorRecovery();
  
  const [showErrorModal, setShowErrorModal] = useState(false);

  // Show error modal when there's an error and recovery is available
  useEffect(() => {
    if (hasError && (canRecover || canRetry)) {
      setShowErrorModal(true);
    }
  }, [hasError, canRecover, canRetry]);

  const handleSignOut = async () => {
    try {
      // Clear subscription cache to prevent stale data
      localStorage.removeItem('subscription_cached_status');
      localStorage.removeItem('subscription_last_check');
      localStorage.removeItem('subscription_config');
      
      await signOut();
      
      // Force redirect to sign in page
      window.location.href = './signin.html';
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Only show the main app when the state is DATA_LOADED (Phase 4 complete)
  
  // If user is anonymous, redirect to sign-in page
  if (state?.state === 'ANONYMOUS') {
    window.location.href = './signin.html';
    return null;
  }
  
  // Show loading while authentication data is loading
  if (loading || !isDataLoaded) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-custom-gray text-custom-white' : 'bg-custom-white text-custom-black'}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-400 mx-auto mb-4"></div>
          <p>Loading authentication...</p>
          <div className="mt-4">
            <StorageStatusIndicator />
          </div>
        </div>
      </div>
    );
  }

  // User is authenticated, use SubscriptionGuard for comprehensive subscription handling
  return (
    <>
      <SubscriptionGuard
        darkMode={darkMode}
        onSignOut={handleSignOut}
      >
        <App onSignOut={handleSignOut} />
      </SubscriptionGuard>
      <ErrorRecoveryModal 
        isOpen={showErrorModal} 
        onClose={() => setShowErrorModal(false)} 
      />
    </>
  );
};

export default AuthWrapper; 