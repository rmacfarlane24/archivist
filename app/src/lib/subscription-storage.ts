/**
 * Local Storage Utilities for Enhanced Subscription System
 * 
 * Handles caching subscription data locally for offline bypass prevention
 */

import {
  EnhancedUserSubscription,
  SubscriptionCheckConfig,
  DEFAULT_SUBSCRIPTION_CONFIG,
  SUBSCRIPTION_STORAGE_KEYS
} from '../types/enhanced-subscription';

/**
 * Update local subscription data from server response
 * This is called after successful webhook updates or manual refreshes
 */
export function updateLocalSubscriptionData(subscription: EnhancedUserSubscription): void {
  try {
    const serialized = {
      ...subscription,
      lastSync: subscription.lastSync.toISOString(),
      subscriptionEndsAt: subscription.subscriptionEndsAt?.toISOString(),
      trialEndsAt: subscription.trialEndsAt?.toISOString(),
      gracePeriodEnd: subscription.gracePeriodEnd?.toISOString(),
      lastPaymentDate: subscription.lastPaymentDate?.toISOString(),
      lastPaymentFailure: subscription.lastPaymentFailure?.toISOString(),
      localData: {
        ...subscription.localData,
        endDate: subscription.localData.endDate?.toISOString() || null
      }
    };

    localStorage.setItem(SUBSCRIPTION_STORAGE_KEYS.CACHED_STATUS, JSON.stringify(serialized));
    localStorage.setItem(SUBSCRIPTION_STORAGE_KEYS.LAST_CHECK, new Date().toISOString());

    console.log('[Local Storage] Updated subscription data', {
      status: subscription.subscriptionStatus,
      endDate: subscription.localData.endDate?.toISOString(),
      lastSync: subscription.lastSync.toISOString()
    });
  } catch (error) {
    console.error('[Local Storage] Failed to update subscription data:', error);
  }
}

/**
 * Get cached subscription configuration
 */
export function getSubscriptionConfig(): SubscriptionCheckConfig {
  try {
    const cached = localStorage.getItem(SUBSCRIPTION_STORAGE_KEYS.CONFIG);
    if (cached) {
      return { ...DEFAULT_SUBSCRIPTION_CONFIG, ...JSON.parse(cached) };
    }
  } catch (error) {
    console.warn('[Local Storage] Failed to parse config, using defaults:', error);
  }
  
  return DEFAULT_SUBSCRIPTION_CONFIG;
}

/**
 * Update subscription configuration
 */
export function updateSubscriptionConfig(config: Partial<SubscriptionCheckConfig>): void {
  try {
    const current = getSubscriptionConfig();
    const updated = { ...current, ...config };
    
    localStorage.setItem(SUBSCRIPTION_STORAGE_KEYS.CONFIG, JSON.stringify(updated));
    console.log('[Local Storage] Updated subscription config:', updated);
  } catch (error) {
    console.error('[Local Storage] Failed to update config:', error);
  }
}

/**
 * Check if user should be prompted to refresh subscription status
 * This helps with UX by showing prompts before blocking access
 */
export function shouldPromptForRefresh(): boolean {
  try {
    const lastCheck = localStorage.getItem(SUBSCRIPTION_STORAGE_KEYS.LAST_CHECK);
    if (!lastCheck) return true;

    const lastCheckTime = new Date(lastCheck);
    if (isNaN(lastCheckTime.getTime())) return true;
    
    const now = new Date();
    const timeSinceLastCheck = now.getTime() - lastCheckTime.getTime();

    // Prompt for refresh if it's been more than 6 hours
    const PROMPT_THRESHOLD = 6 * 60 * 60 * 1000;
    return timeSinceLastCheck > PROMPT_THRESHOLD;
  } catch (error) {
    console.warn('[Local Storage] Failed to check last refresh time:', error);
    return true;
  }
}

/**
 * Get time since last successful subscription check
 */
export function getTimeSinceLastCheck(): number | null {
  try {
    const lastCheck = localStorage.getItem(SUBSCRIPTION_STORAGE_KEYS.LAST_CHECK);
    if (!lastCheck) return null;

    const lastCheckTime = new Date(lastCheck);
    if (isNaN(lastCheckTime.getTime())) return null;
    
    const now = new Date();
    return now.getTime() - lastCheckTime.getTime();
  } catch (error) {
    console.warn('[Local Storage] Failed to get time since last check:', error);
    return null;
  }
}

/**
 * Check if subscription data exists in local storage
 */
export function hasLocalSubscriptionData(): boolean {
  try {
    const cached = localStorage.getItem(SUBSCRIPTION_STORAGE_KEYS.CACHED_STATUS);
    return cached !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Get local subscription expiry date (for UI display)
 */
export function getLocalExpiryDate(): Date | null {
  try {
    const cached = localStorage.getItem(SUBSCRIPTION_STORAGE_KEYS.CACHED_STATUS);
    if (!cached) return null;

    const data = JSON.parse(cached);
    return data.localData?.endDate ? new Date(data.localData.endDate) : null;
  } catch (error) {
    console.warn('[Local Storage] Failed to get local expiry date:', error);
    return null;
  }
}

/**
 * Clear all subscription-related local storage
 * Call this on sign out or when switching users
 */
export function clearAllSubscriptionData(): void {
  try {
    Object.values(SUBSCRIPTION_STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    console.log('[Local Storage] Cleared all subscription data');
  } catch (error) {
    console.error('[Local Storage] Failed to clear subscription data:', error);
  }
}

/**
 * Debug function to log all stored subscription data
 */
export function debugLogStoredData(): void {
  console.group('[Local Storage Debug] Stored Subscription Data');
  
  try {
    Object.entries(SUBSCRIPTION_STORAGE_KEYS).forEach(([name, key]) => {
      const value = localStorage.getItem(key);
      if (value) {
        try {
          console.log(name, JSON.parse(value));
        } catch {
          console.log(name, value);
        }
      } else {
        console.log(name, 'null');
      }
    });
  } catch (error) {
    console.error('Failed to debug log data:', error);
  }
  
  console.groupEnd();
}

/**
 * Migrate old subscription data format if needed
 * This helps maintain compatibility with existing users
 */
export function migrateOldSubscriptionData(): void {
  try {
    // Check for old format data that might exist
    const oldKeys = [
      'archivist_subscription',
      'archivist_user_subscription',
      'subscription_cache'
    ];

    let migrated = false;
    
    oldKeys.forEach(oldKey => {
      const oldData = localStorage.getItem(oldKey);
      if (oldData) {
        console.log(`[Local Storage] Found old subscription data with key: ${oldKey}`);
        // Remove old data to clean up
        localStorage.removeItem(oldKey);
        migrated = true;
      }
    });

    if (migrated) {
      console.log('[Local Storage] Cleaned up old subscription data format');
    }
  } catch (error) {
    console.warn('[Local Storage] Failed to migrate old data:', error);
  }
}