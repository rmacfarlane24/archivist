/**
 * Subscription Prompt Component
 * 
 * Non-blocking component that shows warnings when subscription is approaching expiry.
 * Appears as a subtle notification that doesn't block app usage.
 */

import React, { useState } from 'react';
import { SubscriptionStatus } from '../types/enhanced-subscription';
import { supabaseClient } from '../supabase-client';

interface SubscriptionPromptProps {
  subscriptionStatus: SubscriptionStatus;
  onDismiss: () => void;
  darkMode: boolean;
}

const SubscriptionPrompt: React.FC<SubscriptionPromptProps> = ({ 
  subscriptionStatus, 
  onDismiss, 
  darkMode 
}) => {
  const [isCreatingPortalSession, setIsCreatingPortalSession] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const handleManageBilling = async () => {
    try {
      setIsCreatingPortalSession(true);
      
      // Create Stripe billing portal session
      const { data, error } = await supabaseClient.functions.invoke('create-portal-session');
      
      if (error) {
        console.error('Error creating portal session:', error);
        throw error;
      }
      
      if (data?.url) {
        // Open billing portal in new tab
        window.open(data.url, '_blank');
      } else {
        throw new Error('No portal URL returned');
      }
    } catch (error) {
      console.error('Failed to open billing portal:', error);
      alert('Unable to open billing portal. Please try again later.');
    } finally {
      setIsCreatingPortalSession(false);
    }
  };

  const getDaysUntilExpiry = () => {
    const now = new Date();
    let endDate: Date | null = null;
    
    // Determine which end date to use based on subscription status
    if (subscriptionStatus.status === 'trial' && subscriptionStatus.trialEndsAt) {
      endDate = subscriptionStatus.trialEndsAt;
    } else if (subscriptionStatus.subscriptionEndsAt) {
      endDate = subscriptionStatus.subscriptionEndsAt;
    }
    
    if (!endDate) return null;
    
    const diffInMs = endDate.getTime() - now.getTime();
    const diffInDays = Math.ceil(diffInMs / (1000 * 60 * 60 * 24));
    return diffInDays;
  };

  const getPromptMessage = () => {
    const daysLeft = getDaysUntilExpiry();
    
    if (subscriptionStatus.status === 'trial') {
      if (daysLeft === null) return 'Your free trial is ending soon';
      if (daysLeft <= 0) return 'Your free trial has ended';
      if (daysLeft === 1) return 'Your free trial ends tomorrow';
      if (daysLeft <= 3) return `Your free trial ends in ${daysLeft} days`;
      if (daysLeft <= 7) return `Your free trial ends in ${daysLeft} days`;
      return `Your free trial ends in ${daysLeft} days`;
    }
    
    if (subscriptionStatus.status === 'active') {
      if (daysLeft === null) return 'Your subscription is ending soon';
      if (daysLeft <= 0) return 'Your subscription has expired';
      if (daysLeft === 1) return 'Your subscription expires tomorrow';
      if (daysLeft <= 3) return `Your subscription expires in ${daysLeft} days`;
      if (daysLeft <= 7) return `Your subscription expires in ${daysLeft} days`;
      return `Your subscription expires in ${daysLeft} days`;
    }
    
    return 'Subscription update required';
  };

  const getPromptAction = () => {
    if (subscriptionStatus.status === 'trial') {
      return 'Choose a plan to continue';
    }
    return 'Manage subscription';
  };

  const getPromptIcon = () => {
    const daysLeft = getDaysUntilExpiry();
    
    if (daysLeft !== null && daysLeft <= 1) {
      // Urgent - red warning
      return (
        <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      );
    }
    
    if (daysLeft !== null && daysLeft <= 3) {
      // Warning - orange
      return (
        <svg className="h-5 w-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    
    // Info - blue
    return (
      <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  };

  if (isMinimized) {
    return (
      <div className={`fixed top-4 right-4 z-50 ${
        darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
      } border rounded-lg shadow-lg p-2 cursor-pointer transition-all hover:shadow-xl`}
      onClick={() => setIsMinimized(false)}>
        <div className="flex items-center space-x-2">
          {getPromptIcon()}
          <span className="text-sm font-medium">Subscription</span>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed top-4 right-4 z-50 max-w-sm ${
      darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
    } border rounded-lg shadow-lg transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-3">
        <div className="flex items-center space-x-2">
          {getPromptIcon()}
          <h3 className="font-medium text-sm">Subscription Notice</h3>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setIsMinimized(true)}
            className={`p-1 rounded hover:${darkMode ? 'bg-gray-700' : 'bg-gray-100'} transition-colors`}
            title="Minimize"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            onClick={onDismiss}
            className={`p-1 rounded hover:${darkMode ? 'bg-gray-700' : 'bg-gray-100'} transition-colors`}
            title="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="px-4 pb-4">
        <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          {getPromptMessage()}
        </p>
        
        {/* Action Button */}
        <button
          onClick={handleManageBilling}
          disabled={isCreatingPortalSession}
          className={`w-full py-2 px-3 text-sm rounded-md font-medium transition-all ${
            darkMode 
              ? 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-800' 
              : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-400'
          } disabled:cursor-not-allowed`}
        >
          {isCreatingPortalSession ? (
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
              Loading...
            </div>
          ) : (
            getPromptAction()
          )}
        </button>
        
        {/* Dismiss option */}
        <button
          onClick={onDismiss}
          className={`w-full mt-2 py-1 text-xs ${
            darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
          } transition-colors`}
        >
          Remind me later
        </button>
      </div>
    </div>
  );
};

export default SubscriptionPrompt;