/**
 * Enhanced Subscription Types for Phase 2
 * 
 * These types extend the existing subscription system to support:
 * - Offline bypass prevention
 * - Payment failure handling  
 * - Enhanced status tracking from Phase 1 database schema
 */

// Enhanced subscription status that maps to database subscription_status column
export type SubscriptionStatusType = 'trial' | 'active' | 'expired' | 'overdue' | 'cancelled';

// Comprehensive subscription status returned by checking functions
export interface SubscriptionStatus {
  // Basic status
  isValid: boolean;
  status: SubscriptionStatusType;
  requiresReauth: boolean;
  message?: string;
  
  // Detailed flags
  isSubscribed: boolean;
  isTrialing: boolean;
  isExpired: boolean;
  isOverdue: boolean;
  
  // Time remaining calculations
  trialDaysRemaining: number;
  subscriptionDaysRemaining: number | null;
  gracePeriodDaysRemaining: number;
  
  // Important dates
  subscriptionEndsAt: Date | null;
  trialEndsAt: Date | null;
  gracePeriodEnd: Date | null;
  
  // Payment status
  paymentFailed: boolean;
  lastPaymentDate: Date | null;
  lastPaymentFailure: Date | null;
  
  // Subscription details
  plan: string;
  accessGranted: boolean;
}

// Enhanced user subscription that includes Phase 1 fields
export interface EnhancedUserSubscription {
  // Existing fields
  userId: string;
  plan: string;
  accessGranted: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionEndsAt?: Date;
  trialEndsAt?: Date;
  lastPaymentDate?: Date;
  
  // New Phase 1 fields
  subscriptionStatus: SubscriptionStatusType;
  gracePeriodEnd?: Date;
  paymentFailed: boolean;
  lastPaymentFailure?: Date;
  
  // Cached locally for offline checking
  lastSync: Date;
  localData: {
    endDate: Date | null; // The critical date for offline checking
    status: SubscriptionStatusType;
    requiresOnlineCheck: boolean;
  };
}

// Configuration for subscription checking behavior
export interface SubscriptionCheckConfig {
  // Force online verification within this time of expiry (milliseconds)
  forceOnlineCheckWindow: number; // Default: 24 hours
  
  // Grace period after subscription ends before blocking (milliseconds)  
  gracePeriodDuration: number; // Default: 0 (immediate blocking)
  
  // How often to check subscription during active sessions (milliseconds)
  periodicCheckInterval: number; // Default: 1 hour
  
  // Offline mode behavior
  allowOfflineGracePeriod: boolean; // Default: false
  offlineGraceDuration: number; // Default: 0
}

// Default configuration
export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionCheckConfig = {
  forceOnlineCheckWindow: 24 * 60 * 60 * 1000, // 24 hours
  gracePeriodDuration: 0, // No grace period - immediate blocking  
  periodicCheckInterval: 60 * 60 * 1000, // 1 hour
  allowOfflineGracePeriod: false,
  offlineGraceDuration: 0
};

// Error types for subscription checking
export class SubscriptionError extends Error {
  constructor(
    message: string,
    public code: 'NETWORK_ERROR' | 'AUTH_ERROR' | 'EXPIRED' | 'OVERDUE' | 'UNKNOWN',
    public details?: any
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

// Local storage keys for subscription data
export const SUBSCRIPTION_STORAGE_KEYS = {
  CACHED_STATUS: 'archivist_subscription_status',
  LAST_CHECK: 'archivist_last_subscription_check',
  CONFIG: 'archivist_subscription_config'
} as const;

// Events that subscription system can emit
export type SubscriptionEvent = {
  type: 'status_changed';
  status: SubscriptionStatus;
} | {
  type: 'expired';
  reason: 'trial_ended' | 'payment_failed' | 'subscription_ended';
} | {
  type: 'requires_reauth';
  reason: string;
} | {
  type: 'payment_failed';
  details: any;
};

// Callback function type for subscription events
export type SubscriptionEventCallback = (event: SubscriptionEvent) => void;