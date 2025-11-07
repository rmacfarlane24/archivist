import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabaseClient } from '../supabase-client';
import { 
  UserSubscription, 
  PricingPlan, 
  LocalizedPrice,
  PRICING_PLANS
} from '../types/subscription';

interface SubscriptionContextType {
  userSubscription: UserSubscription | null;
  pricingPlans: PricingPlan[];
  loading: boolean;
  error: string | null;
  
  // Methods
  refreshSubscription: () => Promise<void>;
  updateSubscriptionAfterPayment: (plan: string, sessionId: string) => Promise<boolean>;
  getLocalizedPrice: (plan: PricingPlan) => Promise<LocalizedPrice>;
  formatPrice: (amount: number, currency: string) => string;
  calculateTrialDaysRemaining: (trialEnd: Date) => number;
  canAccessFeature: (feature: string) => boolean;
  isTrialExpired: () => boolean;
  canUseApp: () => boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, session } = useAuth();
  const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Format price using browser's Intl API for localization
  const formatPrice = useCallback((amount: number, currency: string): string => {
    try {
      return new Intl.NumberFormat(navigator.language, {
        style: 'currency',
        currency: currency.toUpperCase(),
        minimumFractionDigits: 2
      }).format(amount / 100); // Convert from pence/cents to major currency unit
    } catch (e) {
      // Fallback if currency not supported
      return `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;
    }
  }, []);

  // Get localized price (for now, mock conversion - will integrate with Stripe later)
  const getLocalizedPrice = useCallback(async (plan: PricingPlan): Promise<LocalizedPrice> => {
    try {
      // TODO: Replace with actual Stripe price conversion API call
      // For now, detect user's currency and do basic conversion
      const userCurrency = getUserCurrency();
      const convertedAmount = await convertPrice(plan.price * 100, plan.currency, userCurrency); // Convert to pence/cents
      
      return {
        amount: convertedAmount,
        currency: userCurrency,
        formatted: formatPrice(convertedAmount, userCurrency)
      };
    } catch (e) {
      // Fallback to original plan currency
      return {
        amount: plan.price * 100, // Convert to pence/cents
        currency: plan.currency,
        formatted: formatPrice(plan.price * 100, plan.currency)
      };
    }
  }, [formatPrice]);

  // Calculate trial days remaining
  const calculateTrialDaysRemaining = useCallback((trialEnd: Date): number => {
    const now = new Date();
    const diffTime = trialEnd.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }, []);

  // Check if user can access a specific feature
  const canAccessFeature = useCallback((feature: string): boolean => {
    if (!userSubscription) return false;
    
    // If they have access granted, allow all features
    if (userSubscription.accessGranted) return true;
    
    // Check if they're in trial period
    const now = new Date();
    if (userSubscription.trialEndsAt && userSubscription.trialEndsAt > now) {
      return true; // In trial, allow all features
    }
    
    // Check current plan features
    const currentPlan = PRICING_PLANS.find(p => p.id === userSubscription.plan);
    return currentPlan?.features.includes(feature) || false;
  }, [userSubscription]);

  // Check if user's trial has expired
  const isTrialExpired = useCallback((): boolean => {
    if (!userSubscription) return false;
    
    const now = new Date();
    if (!userSubscription.trialEndsAt) return false;
    
    return userSubscription.trialEndsAt <= now;
  }, [userSubscription]);

  // Check if user can use the app (not blocked by trial expiration)
  const canUseApp = useCallback((): boolean => {
    if (!userSubscription) {
      return false;
    }
    
    const now = new Date();
    
    // Check if user is still in trial period
    if (userSubscription.trialEndsAt && userSubscription.trialEndsAt > now) {
      return true;
    }
    
    // Check if user has an active paid subscription
    if (userSubscription.accessGranted) {
      // If they have lifetime access (no subscription_ends_at), allow access
      if (!userSubscription.subscriptionEndsAt) {
        return true;
      }
      
      // If they have a subscription that hasn't expired, allow access
      if (userSubscription.subscriptionEndsAt > now) {
        return true;
      }
    }
    
    // No trial and no active subscription - block access
    return false;
  }, [userSubscription]);

  // Fetch subscription data
  const refreshSubscription = useCallback(async () => {
    if (!user || !session) {
      setUserSubscription(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch real subscription data from Supabase
      const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        throw error;
      }

      // Convert profile data to UserSubscription format
      const subscription: UserSubscription = {
        userId: profile.id,
        plan: profile.plan || 'free',
        accessGranted: profile.access_granted || false,
        stripeCustomerId: profile.stripe_customer_id,
        stripeSubscriptionId: profile.stripe_subscription_id,
        subscriptionEndsAt: profile.subscription_ends_at ? new Date(profile.subscription_ends_at) : undefined,
        trialEndsAt: profile.trial_ends_at ? new Date(profile.trial_ends_at) : undefined,
        lastPaymentDate: profile.last_payment_date ? new Date(profile.last_payment_date) : undefined,
        paymentFailed: profile.payment_failed || false,
        lastPaymentFailure: profile.last_payment_failure ? new Date(profile.last_payment_failure) : undefined
      };

      setUserSubscription(subscription);
      
    } catch (err) {
      console.error('[SubscriptionContext] Error fetching subscription:', err);
      setError('Failed to load subscription data');
      setUserSubscription(null);
    } finally {
      setLoading(false);
    }
  }, [user, session]);

  // LEGACY PAYMENT SYSTEM - DORMANT
  // Update subscription after successful payment
  const updateSubscriptionAfterPayment = useCallback(async (plan: string, sessionId: string): Promise<boolean> => {
    // LEGACY SYSTEM DISABLED - Return false to prevent usage
    console.warn('updateSubscriptionAfterPayment is disabled - new payment system in development');
    return false;

    if (!user) {
      console.error('No user available for subscription update');
      return false;
    }

    // Verify Supabase client is authenticated before proceeding
    const { data: { session: supabaseSession } } = await supabaseClient.auth.getSession();
    if (!supabaseSession) {
      console.error('Supabase client not authenticated - cannot update subscription');
      console.error('User ID from context:', user?.id);
      console.error('Supabase session:', supabaseSession);
      return false;
    }

    try {
      setLoading(true);
      setError(null);

      // Calculate subscription end date based on plan
      let subscriptionEndsAt = null;
      if (plan !== 'lifetime') {
        const now = new Date();
        const daysToAdd = plan === 'monthly' ? 30 : 365;
        subscriptionEndsAt = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();
      }

      // console.log('Updating subscription directly via Supabase client');
      // console.log('User ID:', user.id);
      // console.log('Plan:', plan);
      // console.log('Session ID:', sessionId);

      // First, let's check if the profile exists
      const { error: checkError } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .single();

      // console.log('Existing profile check:', existingProfile);
      // console.log('Profile check error:', checkError);

      if (checkError) {
        console.error('Error checking existing profile:', checkError);
        throw new Error('Could not verify profile exists');
      }

      // Update the user's profile using simple UPDATE operation
      const { error } = await supabaseClient
        .from('profiles')
        .update({
          plan: plan,
          access_granted: true,
          last_payment_date: new Date().toISOString(),
          stripe_customer_id: sessionId,
          subscription_ends_at: subscriptionEndsAt,
          // Clear trial end date since they now have paid access
          trial_ends_at: null
        })
        .eq('id', user!.id)
        .select(); // Add select() to return the updated data

      if (error) {
        console.error('Error updating subscription via Supabase client:', error);
        throw new Error(error?.message || 'Failed to update subscription');
      }

      // console.log('Subscription updated successfully via Supabase client:', data);

      // Refresh subscription data to reflect the changes
      await refreshSubscription();
      
      return true;
    } catch (err) {
      console.error('Error updating subscription:', err);
      setError('Failed to update subscription after payment');
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, refreshSubscription]);

  // Load subscription data when user changes
  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  // Real-time subscription updates
  useEffect(() => {
    if (!user) return;

    // console.log('Setting up real-time subscription listener for user:', user.id);

    // Create real-time subscription
    const subscription = supabaseClient
      .channel('subscription-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`
      }, (payload) => {
        console.log('Subscription updated via real-time:', payload);
        
        // Update local subscription state
        if (payload.new) {
          const updatedProfile = payload.new;
          const subscription: UserSubscription = {
            userId: updatedProfile.id,
            plan: updatedProfile.plan || 'free',
            accessGranted: updatedProfile.access_granted || false,
            stripeCustomerId: updatedProfile.stripe_customer_id,
            stripeSubscriptionId: updatedProfile.stripe_subscription_id,
            subscriptionEndsAt: updatedProfile.subscription_ends_at ? new Date(updatedProfile.subscription_ends_at) : undefined,
            trialEndsAt: updatedProfile.trial_ends_at ? new Date(updatedProfile.trial_ends_at) : undefined,
            lastPaymentDate: updatedProfile.last_payment_date ? new Date(updatedProfile.last_payment_date) : undefined,
            paymentFailed: updatedProfile.payment_failed || false,
            lastPaymentFailure: updatedProfile.last_payment_failure ? new Date(updatedProfile.last_payment_failure) : undefined
          };
          
          setUserSubscription(subscription);
          console.log('Real-time subscription update applied:', subscription);
        }
      })
      .subscribe(() => {
        // Real-time subscription status updates handled above
      });

    // Cleanup subscription on unmount
    return () => {
      console.log('Cleaning up real-time subscription listener');
      subscription.unsubscribe();
    };
  }, [user]);

  const value: SubscriptionContextType = {
    userSubscription,
    pricingPlans: PRICING_PLANS,
    loading,
    error,
    refreshSubscription,
    updateSubscriptionAfterPayment,
    getLocalizedPrice,
    formatPrice,
    calculateTrialDaysRemaining,
    canAccessFeature,
    isTrialExpired,
    canUseApp
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
};

// Helper functions

function getUserCurrency(): string {
  try {
    // Try to detect user's currency from browser locale
    const locale = navigator.language || 'en-GB';
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
    const parts = formatter.formatToParts(1);
    const currencyPart = parts.find(part => part.type === 'currency');
    
    if (currencyPart) {
      return currencyPart.value;
    }
    
    // Fallback based on common locales
    if (locale.startsWith('en-US')) return 'USD';
    if (locale.startsWith('en-GB')) return 'GBP';
    if (locale.startsWith('de') || locale.startsWith('fr') || locale.startsWith('es')) return 'EUR';
    
    return 'GBP'; // Default fallback
  } catch (e) {
    return 'GBP';
  }
}

async function convertPrice(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
  if (fromCurrency === toCurrency) return amount;
  
  // TODO: Implement actual currency conversion
  // For now, use rough conversion rates (these should come from Stripe)
  const conversionRates: Record<string, Record<string, number>> = {
    'GBP': {
      'USD': 1.27,
      'EUR': 1.17,
      'CAD': 1.71,
      'AUD': 1.91
    }
  };
  
  const rate = conversionRates[fromCurrency]?.[toCurrency] || 1;
  return Math.round(amount * rate);
}


