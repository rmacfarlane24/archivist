/**
 * Enhanced Subscription Monitoring Hook
 * 
 * Provides real-time subscription status monitoring with:
 * - Periodic checks during active sessions
 * - Automatic reauth when subscriptions expire
 * - Event-driven updates for better UX
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  SubscriptionStatus,
  SubscriptionEventCallback,
  SubscriptionError
} from '../types/enhanced-subscription';
import { checkSubscriptionStatus, clearCachedSubscriptionData } from '../lib/enhanced-subscription-checker';
import { 
  getSubscriptionConfig, 
  shouldPromptForRefresh,
  clearAllSubscriptionData 
} from '../lib/subscription-storage';

interface UseSubscriptionMonitorResult {
  // Current subscription status
  subscriptionStatus: SubscriptionStatus | null;
  
  // Loading states
  isLoading: boolean;
  isChecking: boolean;
  
  // Error state
  error: string | null;
  
  // Actions
  refreshStatus: () => Promise<void>;
  clearError: () => void;
  
  // Status helpers
  canUseApp: () => boolean;
  isTrialExpired: () => boolean;
  isPaymentOverdue: () => boolean;
  requiresReauth: () => boolean;
  
  // Time helpers
  getDaysUntilExpiry: () => number | null;
  getExpiryMessage: () => string | null;
}

/**
 * Main subscription monitoring hook
 * 
 * This hook:
 * 1. Checks subscription status on mount
 * 2. Periodically rechecks during active sessions
 * 3. Forces reauth when subscriptions expire
 * 4. Provides real-time status updates
 */
export function useSubscriptionMonitor(
  onStatusChange?: SubscriptionEventCallback
): UseSubscriptionMonitorResult {
  const { user, signOut } = useAuth();
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Use refs to prevent stale closures in intervals
  const statusRef = useRef<SubscriptionStatus | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Update ref when status changes
  useEffect(() => {
    statusRef.current = subscriptionStatus;
  }, [subscriptionStatus]);

  /**
   * Perform subscription status check
   */
  const performStatusCheck = useCallback(async (forceOnlineCheck: boolean = false) => {
    if (!user) {

      setSubscriptionStatus(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsChecking(true);
      setError(null);

      const config = getSubscriptionConfig();
      const status = await checkSubscriptionStatus(user, config, forceOnlineCheck);
      


      // Check if status changed significantly
      const previousStatus = statusRef.current;
      const statusChanged = !previousStatus || 
                           previousStatus.status !== status.status ||
                           previousStatus.isValid !== status.isValid;

      setSubscriptionStatus(status);

      // Emit status change event
      if (statusChanged && onStatusChange) {
        onStatusChange({
          type: 'status_changed',
          status
        });
      }

      // Handle critical status changes
      if (status.requiresReauth) {
        console.warn('[Subscription Monitor] Subscription requires reauth - signing out');
        
        if (onStatusChange) {
          onStatusChange({
            type: 'requires_reauth',
            reason: status.message || 'Subscription verification required'
          });
        }

        // Clear cached data and sign out
        clearCachedSubscriptionData();
        clearAllSubscriptionData();
        await signOut();
        return;
      }

      // Handle expired subscriptions
      if (!status.isValid) {
        if (status.isExpired && onStatusChange) {
          onStatusChange({
            type: 'expired',
            reason: 'trial_ended'
          });
        } else if (status.isOverdue && onStatusChange) {
          onStatusChange({
            type: 'expired',
            reason: 'payment_failed'
          });
        }
      }

      // Handle payment failures
      if (status.paymentFailed && onStatusChange) {
        onStatusChange({
          type: 'payment_failed',
          details: {
            lastFailure: status.lastPaymentFailure,
            plan: status.plan
          }
        });
      }

    } catch (err) {
      console.error('[Subscription Monitor] Status check failed:', err);
      
      const errorMessage = err instanceof SubscriptionError 
        ? err.message 
        : 'Failed to check subscription status';
      
      setError(errorMessage);

      // If it's a critical error that prevents app usage, handle it
      if (err instanceof SubscriptionError && 
          (err.code === 'EXPIRED' || err.code === 'OVERDUE')) {
        console.warn('[Subscription Monitor] Critical subscription error - signing out');
        await signOut();
      }
    } finally {
      setIsChecking(false);
      setIsLoading(false);
    }
  }, [user, signOut, onStatusChange]);

  /**
   * Refresh subscription status (force online check)
   */
  const refreshStatus = useCallback(async () => {
    await performStatusCheck(true);
  }, [performStatusCheck]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Check if user can use the app
   */
  const canUseApp = useCallback(() => {
    return subscriptionStatus?.isValid ?? false;
  }, [subscriptionStatus]);

  /**
   * Check if trial has expired
   */
  const isTrialExpired = useCallback(() => {
    return subscriptionStatus?.isExpired ?? false;
  }, [subscriptionStatus]);

  /**
   * Check if payment is overdue
   */
  const isPaymentOverdue = useCallback(() => {
    return subscriptionStatus?.isOverdue ?? false;
  }, [subscriptionStatus]);

  /**
   * Check if reauth is required
   */
  const requiresReauth = useCallback(() => {
    return subscriptionStatus?.requiresReauth ?? false;
  }, [subscriptionStatus]);

  /**
   * Get days until subscription expires
   */
  const getDaysUntilExpiry = useCallback(() => {
    if (!subscriptionStatus) return null;
    
    if (subscriptionStatus.isTrialing) {
      return subscriptionStatus.trialDaysRemaining;
    }
    
    if (subscriptionStatus.isSubscribed) {
      return subscriptionStatus.subscriptionDaysRemaining;
    }
    
    return 0;
  }, [subscriptionStatus]);

  /**
   * Get user-friendly expiry message
   */
  const getExpiryMessage = useCallback(() => {
    if (!subscriptionStatus) return null;
    
    if (subscriptionStatus.isTrialing) {
      const days = subscriptionStatus.trialDaysRemaining;
      if (days === 0) return 'Your trial expires today';
      if (days === 1) return 'Your trial expires tomorrow';
      return `Your trial expires in ${days} days`;
    }
    
    if (subscriptionStatus.isSubscribed && subscriptionStatus.subscriptionDaysRemaining !== null) {
      const days = subscriptionStatus.subscriptionDaysRemaining;
      if (days === 0) return 'Your subscription expires today';
      if (days === 1) return 'Your subscription expires tomorrow';
      return `Your subscription expires in ${days} days`;
    }
    
    if (subscriptionStatus.isExpired) {
      return 'Your trial has expired';
    }
    
    if (subscriptionStatus.isOverdue) {
      return 'Your subscription payment is overdue';
    }
    
    return null;
  }, [subscriptionStatus]);

  // Initial status check when user changes
  useEffect(() => {

    performStatusCheck(false);
  }, [performStatusCheck]);

  // Set up periodic checking during active sessions
  useEffect(() => {
    if (!user || !subscriptionStatus) return;

    const config = getSubscriptionConfig();
    


    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Set up new interval
    intervalRef.current = setInterval(async () => {

      
      // Check if we should prompt for refresh
      const shouldPrompt = shouldPromptForRefresh();
      await performStatusCheck(shouldPrompt);
    }, config.periodicCheckInterval);

    // Cleanup interval on unmount or dependency change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [user, subscriptionStatus, performStatusCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Log status changes for debugging
  useEffect(() => {
    if (subscriptionStatus) {

    }
  }, [subscriptionStatus, getDaysUntilExpiry]);

  return {
    subscriptionStatus,
    isLoading,
    isChecking,
    error,
    refreshStatus,
    clearError,
    canUseApp,
    isTrialExpired,
    isPaymentOverdue,
    requiresReauth,
    getDaysUntilExpiry,
    getExpiryMessage
  };
}