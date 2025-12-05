/**
 * Enhanced Subscription Status Checker
 * 
 * Core logic for Phase 2: Prevents offline bypass and handles payment failures
 * This is the heart of the subscription enforcement system.
 */

import { supabaseClient } from '../supabase-client';
import {
  SubscriptionStatus,
  SubscriptionStatusType,
  EnhancedUserSubscription,
  SubscriptionCheckConfig,
  SubscriptionError,
  DEFAULT_SUBSCRIPTION_CONFIG,
  SUBSCRIPTION_STORAGE_KEYS
} from '../types/enhanced-subscription';

/**
 * Main subscription status checker - prevents offline bypass
 * 
 * This function implements the core requirement:
 * - Store subscription end dates locally
 * - Force online verification when those dates pass
 * - Deny access if offline and subscription expired
 * - Handle both trial expiry and payment failures
 */
export async function checkSubscriptionStatus(
  user: any,
  config: SubscriptionCheckConfig = DEFAULT_SUBSCRIPTION_CONFIG,
  forceOnlineCheck: boolean = false
): Promise<SubscriptionStatus> {
  const now = new Date();
  
  // Try to get cached data first
  const cachedData = await getCachedSubscriptionData();

  // CRITICAL: Check if subscription has expired based on local data
  const localEndDate = cachedData?.localData?.endDate;
  const localStatus = cachedData?.localData?.status;
  
  if (localEndDate && now >= localEndDate) {
    // This is the key security feature - subscription expired, must reauth
    return {
      isValid: false,
      status: localStatus === 'trial' ? 'expired' : 'overdue',
      requiresReauth: true,
      message: localStatus === 'trial' 
        ? 'Your free trial has expired. Please upgrade to continue.' 
        : 'Your subscription payment is overdue. Please update your payment method.',
      isSubscribed: false,
      isTrialing: false,
      isExpired: localStatus === 'trial',
      isOverdue: localStatus !== 'trial',
      trialDaysRemaining: 0,
      subscriptionDaysRemaining: 0,
      gracePeriodDaysRemaining: 0,
      subscriptionEndsAt: cachedData?.subscriptionEndsAt || null,
      trialEndsAt: cachedData?.trialEndsAt || null,
      gracePeriodEnd: cachedData?.gracePeriodEnd || null,
      paymentFailed: cachedData?.paymentFailed || false,
      lastPaymentDate: cachedData?.lastPaymentDate || null,
      lastPaymentFailure: cachedData?.lastPaymentFailure || null,
      plan: cachedData?.plan || 'free',
      accessGranted: false
    };
  }

  // Check if we need to force online verification (approaching expiry)
  if (localEndDate && !forceOnlineCheck) {
    const timeUntilExpiry = localEndDate.getTime() - now.getTime();
    if (timeUntilExpiry < config.forceOnlineCheckWindow) {
      forceOnlineCheck = true;
    }
  }

  // Perform online check if forced or no local data
  if (forceOnlineCheck || !cachedData || shouldRefreshCache(cachedData)) {

    
    try {
      // Fetch enhanced subscription status from database
      const onlineStatus = await fetchEnhancedSubscriptionStatus(user.id);
      
      // Cache the new data locally for offline checking
      cacheSubscriptionData(onlineStatus);
      
      // Return the comprehensive status
      return buildSubscriptionStatus(onlineStatus, now);
      
    } catch (error) {
      console.error('[Enhanced Subscription Check] Online check failed:', error);
      
      // If we can't check online and subscription might be expired, deny access
      if (localEndDate && now >= localEndDate) {
        return {
          isValid: false,
          status: 'expired',
          requiresReauth: true,
          message: 'Unable to verify subscription status. Please connect to the internet.',
          isSubscribed: false,
          isTrialing: false,
          isExpired: true,
          isOverdue: false,
          trialDaysRemaining: 0,
          subscriptionDaysRemaining: 0,
          gracePeriodDaysRemaining: 0,
          subscriptionEndsAt: null,
          trialEndsAt: null,
          gracePeriodEnd: null,
          paymentFailed: false,
          lastPaymentDate: null,
          lastPaymentFailure: null,
          plan: 'free',
          accessGranted: false
        };
      }

      // If we have valid cached data and no imminent expiry, allow access
      if (cachedData && localEndDate && now < localEndDate) {

        return buildSubscriptionStatus(cachedData, now);
      }

      // No valid data available - deny access
      throw new SubscriptionError(
        'Unable to verify subscription status',
        'NETWORK_ERROR',
        error
      );
    }
  }

  // Use cached data for check

  return buildSubscriptionStatus(cachedData, now);
}

/**
 * Fetch enhanced subscription status from database using Phase 1 functions
 */
async function fetchEnhancedSubscriptionStatus(userId: string): Promise<EnhancedUserSubscription> {


  // Use direct profiles table query since get_enhanced_subscription_status doesn't exist
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[Enhanced Subscription Check] Database error:', error);
    throw new SubscriptionError('Database query failed', 'AUTH_ERROR', error);
  }

  if (!data) {
    throw new SubscriptionError('No subscription data found', 'AUTH_ERROR');
  }

  // Map profile data to expected format with proper status determination
  const dbData = {
    plan: data.plan || 'free',
    access_granted: data.access_granted || false,
    stripe_customer_id: data.stripe_customer_id,
    stripe_subscription_id: data.stripe_subscription_id,
    subscription_ends_at: data.subscription_ends_at,
    trial_ends_at: data.trial_ends_at,
    last_payment_date: data.last_payment_date,
    // Determine subscription status based on actual conditions
    subscription_status: data.subscription_status || (
      data.access_granted && data.plan !== 'free' ? 'active' : 'trial'
    ),
    grace_period_end: data.grace_period_end,
    payment_failed: data.payment_failed || false,
    last_payment_failure: data.last_payment_failure,
    requires_reauth: false
  };


  // Convert database response to our enhanced format
  const enhanced: EnhancedUserSubscription = {
    userId,
    plan: dbData.plan || 'free',
    accessGranted: dbData.access_granted || false,
    stripeCustomerId: dbData.stripe_customer_id,
    stripeSubscriptionId: dbData.stripe_subscription_id,
    subscriptionEndsAt: dbData.subscription_ends_at ? new Date(dbData.subscription_ends_at) : undefined,
    trialEndsAt: dbData.trial_ends_at ? new Date(dbData.trial_ends_at) : undefined,
    lastPaymentDate: dbData.last_payment_date ? new Date(dbData.last_payment_date) : undefined,
    subscriptionStatus: dbData.subscription_status as SubscriptionStatusType,
    gracePeriodEnd: dbData.grace_period_end ? new Date(dbData.grace_period_end) : undefined,
    paymentFailed: dbData.payment_failed || false,
    lastPaymentFailure: dbData.last_payment_failure ? new Date(dbData.last_payment_failure) : undefined,
    lastSync: new Date(),
    localData: {
      // The critical date for offline checking - use the earliest expiry date
      endDate: getEarliestExpiryDate(
        dbData.subscription_ends_at ? new Date(dbData.subscription_ends_at) : null,
        dbData.trial_ends_at ? new Date(dbData.trial_ends_at) : null,
        dbData.grace_period_end ? new Date(dbData.grace_period_end) : null
      ),
      status: dbData.subscription_status as SubscriptionStatusType,
      requiresOnlineCheck: dbData.requires_reauth || false
    }
  };


  return enhanced;
}

/**
 * Build comprehensive subscription status from enhanced data
 */
function buildSubscriptionStatus(
  subscription: EnhancedUserSubscription,
  now: Date
): SubscriptionStatus {
  const trialDaysRemaining = subscription.trialEndsAt 
    ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const subscriptionDaysRemaining = subscription.subscriptionEndsAt 
    ? Math.max(0, Math.ceil((subscription.subscriptionEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  const gracePeriodDaysRemaining = subscription.gracePeriodEnd 
    ? Math.max(0, Math.ceil((subscription.gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  // FIXED: Determine if subscription is valid - prioritize paid access over trial status
  // If user has access_granted=true and a paid plan, they should always be considered subscribed
  const hasPaidAccess = subscription.accessGranted && subscription.plan !== 'free';
  
  const isSubscribed = hasPaidAccess && 
                      (subscriptionDaysRemaining === null || subscriptionDaysRemaining > 0);
  
  // Only consider trialing if they don't have paid access and are still in trial period
  const isTrialing = !hasPaidAccess && 
                    subscription.plan === 'free' && 
                    trialDaysRemaining > 0;
  
  // Only expired if no paid access and trial has ended
  const isExpired = !hasPaidAccess && 
                   subscription.plan === 'free' && 
                   trialDaysRemaining === 0;
  
  // Payment overdue only applies to paid plans with payment issues
  const isOverdue = hasPaidAccess && 
                   subscription.paymentFailed;

  const isValid = isTrialing || isSubscribed;

  // Determine if re-authentication is required
  const requiresReauth = Boolean(subscription.localData.requiresOnlineCheck || 
                                (subscription.localData.endDate && now >= subscription.localData.endDate));

  let message: string | undefined;
  if (!isValid) {
    if (isExpired) {
      message = 'Your free trial has expired. Please upgrade to continue.';
    } else if (isOverdue) {
      message = 'Your subscription payment is overdue. Please update your payment method.';
    } else {
      message = 'Your subscription is not active. Please check your account.';
    }
  }

  return {
    isValid,
    status: subscription.subscriptionStatus,
    requiresReauth,
    message,
    isSubscribed,
    isTrialing,
    isExpired,
    isOverdue,
    trialDaysRemaining,
    subscriptionDaysRemaining,
    gracePeriodDaysRemaining,
    subscriptionEndsAt: subscription.subscriptionEndsAt || null,
    trialEndsAt: subscription.trialEndsAt || null,
    gracePeriodEnd: subscription.gracePeriodEnd || null,
    paymentFailed: subscription.paymentFailed,
    lastPaymentDate: subscription.lastPaymentDate || null,
    lastPaymentFailure: subscription.lastPaymentFailure || null,
    plan: subscription.plan,
    accessGranted: subscription.accessGranted
  };
}

/**
 * Get the earliest expiry date for offline checking
 */
function getEarliestExpiryDate(
  subscriptionEnd: Date | null,
  trialEnd: Date | null,
  gracePeriodEnd: Date | null
): Date | null {
  const dates = [subscriptionEnd, trialEnd, gracePeriodEnd].filter(Boolean) as Date[];
  if (dates.length === 0) return null;
  
  return new Date(Math.min(...dates.map(d => d.getTime())));
}

/**
 * Cache subscription data locally for offline checking
 */
function cacheSubscriptionData(subscription: EnhancedUserSubscription): void {
  try {
    localStorage.setItem(
      SUBSCRIPTION_STORAGE_KEYS.CACHED_STATUS,
      JSON.stringify({
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
      })
    );

    localStorage.setItem(
      SUBSCRIPTION_STORAGE_KEYS.LAST_CHECK,
      new Date().toISOString()
    );


  } catch (error) {
    console.warn('[Enhanced Subscription Check] Failed to cache data:', error);
  }
}

/**
 * Get cached subscription data from local storage
 */
function getCachedSubscriptionData(): EnhancedUserSubscription | null {
  try {
    const cached = localStorage.getItem(SUBSCRIPTION_STORAGE_KEYS.CACHED_STATUS);
    if (!cached) return null;

    const data = JSON.parse(cached);
    
    // Convert ISO strings back to Date objects
    return {
      ...data,
      lastSync: new Date(data.lastSync),
      subscriptionEndsAt: data.subscriptionEndsAt ? new Date(data.subscriptionEndsAt) : undefined,
      trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : undefined,
      gracePeriodEnd: data.gracePeriodEnd ? new Date(data.gracePeriodEnd) : undefined,
      lastPaymentDate: data.lastPaymentDate ? new Date(data.lastPaymentDate) : undefined,
      lastPaymentFailure: data.lastPaymentFailure ? new Date(data.lastPaymentFailure) : undefined,
      localData: {
        ...data.localData,
        endDate: data.localData.endDate ? new Date(data.localData.endDate) : null
      }
    };
  } catch (error) {
    console.warn('[Enhanced Subscription Check] Failed to parse cached data:', error);
    return null;
  }
}

/**
 * Check if cached data should be refreshed
 */
function shouldRefreshCache(cached: EnhancedUserSubscription): boolean {
  const now = new Date();
  const cacheAge = now.getTime() - cached.lastSync.getTime();
  
  // Refresh cache every 5 minutes during active use
  const CACHE_REFRESH_INTERVAL = 5 * 60 * 1000;
  
  return cacheAge > CACHE_REFRESH_INTERVAL;
}

/**
 * Clear cached subscription data (useful for sign out)
 */
export function clearCachedSubscriptionData(): void {
  try {
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEYS.CACHED_STATUS);
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEYS.LAST_CHECK);

  } catch (error) {
    console.warn('[Enhanced Subscription Check] Failed to clear cached data:', error);
  }
}