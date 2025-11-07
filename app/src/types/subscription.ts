// Subscription types and interfaces

export interface SubscriptionTier {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval?: 'monthly' | 'annual' | 'lifetime';
  stripeUrl: string;
  description: string;
  features: string[];
}

export interface PricingPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval?: 'monthly' | 'annual' | 'lifetime';
  stripeUrl: string;
  description: string;
  features: string[];
  popular?: boolean;
}

export interface LocalizedPrice {
  amount: number;
  currency: string;
  formatted: string; // e.g., "$5.00", "£5.00", "€5.50"
}

export type SubscriptionStatus = 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid';

export interface SubscriptionData {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  trialEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  lastPaymentDate?: Date;
  nextPaymentDate?: Date;
}

export interface UserSubscription {
  userId: string;
  plan: string;
  accessGranted: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionEndsAt?: Date;
  trialEndsAt?: Date;
  lastPaymentDate?: Date;
  paymentFailed?: boolean;
  lastPaymentFailure?: Date;
}

// Real Stripe payment URLs with email pre-filling
export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'monthly',
    name: 'Monthly',
    price: 5,
    currency: 'GBP',
    interval: 'monthly',
    stripeUrl: 'https://buy.stripe.com/test_8x24gAenQ6cvbA14RA1oI02',
    description: 'Perfect for getting started',
    features: [
      'Unlimited file scanning',
      'Advanced metadata extraction',
      'Priority support',
      'Monthly billing'
    ]
  },
  {
    id: 'annual',
    name: 'Annual',
    price: 50,
    currency: 'GBP',
    interval: 'annual',
    stripeUrl: 'https://buy.stripe.com/test_4gMdRaa7AeJ1cE54RA1oI01',
    description: 'Best value for power users',

    features: [
      'Everything in Monthly',
      '2 months free',
      'Early access to new features',
      'Annual billing'
    ]
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    price: 100,
    currency: 'GBP',
    interval: 'lifetime',
    stripeUrl: 'https://buy.stripe.com/test_6oU4gAfrUeJ1avX97Q1oI00',
    description: 'One-time payment, forever access',
    features: [
      'Everything in Annual',
      'Lifetime updates',
      'No recurring charges',
      'Best long-term value'
    ]
  }
];

// Helper function to add email to Stripe URLs
export function getStripeUrlWithEmail(baseUrl: string, email: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('prefilled_email', email);
  return url.toString();
}

// Helper function to get plan by ID
export function getPlanById(planId: string): PricingPlan | undefined {
  return PRICING_PLANS.find(plan => plan.id === planId);
}

// Default trial period (14 days)
export const TRIAL_PERIOD_DAYS = 14;
