/**
 * Enhanced Subscription Guard Component
 * 
 * This component wraps the main app and enforces subscription rules with:
 * - Trial expiry blocking
 * - Payment overdue blocking  
 * - Offline bypass prevention
 * - Approaching expiry warnings
 */

import React from 'react';
import { useSubscriptionMonitor } from '../hooks/useSubscriptionMonitor';
import TrialExpiredBlock from './TrialExpiredBlock';
import PaymentOverdueBlock from './PaymentOverdueBlock.tsx';
import SubscriptionPrompt from './SubscriptionPrompt.tsx';

interface SubscriptionGuardProps {
  children: React.ReactNode;
  darkMode: boolean;
  onSignOut: () => void;
}

export const SubscriptionGuard: React.FC<SubscriptionGuardProps> = ({
  children,
  darkMode,
  onSignOut
}) => {
  const {
    subscriptionStatus,
    isLoading,
    error,
    canUseApp,
    isTrialExpired,
    isPaymentOverdue,
    requiresReauth,
    getDaysUntilExpiry,
    refreshStatus,
    clearError
  } = useSubscriptionMonitor();

  // Show loading state
  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        darkMode ? 'bg-custom-gray text-custom-white' : 'bg-custom-white text-custom-black'
      }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-400 mx-auto mb-4"></div>
          <p>Checking subscription status...</p>
        </div>
      </div>
    );
  }

  // Handle errors with retry option
  if (error) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        darkMode ? 'bg-custom-gray text-custom-white' : 'bg-custom-white text-custom-black'
      }`}>
        <div className="text-center max-w-md">
          <div className="mb-6">
            <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${
              darkMode ? 'bg-red-900' : 'bg-red-100'
            }`}>
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
          </div>
          
          <h2 className="text-xl font-semibold mb-2">Connection Error</h2>
          <p className={`text-sm mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            {error}
          </p>
          
          <div className="space-y-3">
            <button
              onClick={() => {
                clearError();
                refreshStatus();
              }}
              className={`w-full px-4 py-2 rounded-md font-medium ${
                darkMode 
                  ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              Try Again
            </button>
            
            <button
              onClick={onSignOut}
              className={`w-full px-4 py-2 rounded-md font-medium ${
                darkMode 
                  ? 'bg-gray-600 hover:bg-gray-700 text-white' 
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
              }`}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If no subscription status data, show loading
  if (!subscriptionStatus) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        darkMode ? 'bg-custom-gray text-custom-white' : 'bg-custom-white text-custom-black'
      }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-400 mx-auto mb-4"></div>
          <p>Loading subscription data...</p>
        </div>
      </div>
    );
  }

  // CRITICAL: If requires reauth, user will be signed out by the monitor hook
  // This should not render, but adding as safety net
  if (requiresReauth()) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        darkMode ? 'bg-custom-gray text-custom-white' : 'bg-custom-white text-custom-black'
      }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-400 mx-auto mb-4"></div>
          <p>Verifying subscription status...</p>
        </div>
      </div>
    );
  }

    // Show trial expired block for users whose trial has ended
  if (isTrialExpired()) {
    return (
      <TrialExpiredBlock 
        darkMode={darkMode} 
        onSignOut={onSignOut} 
      />
    );
  }

  // Show payment overdue block for paying customers whose payment has failed  
  if (isPaymentOverdue()) {
    return (
      <PaymentOverdueBlock
        darkMode={darkMode}
        onSignOut={onSignOut}
        subscriptionStatus={subscriptionStatus}
      />
    );
  }

  // Show main app with subscription prompt for approaching expiry
  const daysUntilExpiry = getDaysUntilExpiry();
  if (daysUntilExpiry !== null && daysUntilExpiry <= 7) {
    return (
      <>
        {children}
        <SubscriptionPrompt 
          darkMode={darkMode}
          subscriptionStatus={subscriptionStatus}
          onDismiss={() => {}} // Handle dismissal if needed
        />
      </>
    );
  }

  // User has valid subscription, show main app
  return (
    <>
      {children}
    </>
  );
};

export default SubscriptionGuard;