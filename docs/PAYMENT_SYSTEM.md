# Payment System Implementation

## 🚀 NEW SUBSCRIPTION SYSTEM (Planned Implementation)

### Overview

This document outlines the comprehensive subscription system that will replace the current one-time payment system. The new system will provide industry-standard subscription management with automatic renewals, plan changes, cancellation handling, and failed payment recovery.

### 🎯 General Outline

#### **Core Features**
- **Recurring Billing**: Automatic monthly/annual payments via Stripe subscriptions
- **Subscription Management**: Users can upgrade, downgrade, and cancel plans
- **Customer Portal**: Self-service billing management via Stripe Customer Portal
- **Failed Payment Handling**: Grace periods, retry logic, and automatic suspension
- **Plan Flexibility**: Easy switching between monthly, annual, and lifetime plans

#### **Technical Architecture**
- **Stripe Subscriptions**: Recurring billing objects instead of one-time payments
- **Enhanced Webhooks**: Comprehensive event handling for subscription lifecycle
- **Database Schema**: Extended to track subscription objects and payment history
- **Edge Functions**: Three functions for checkout, webhooks, and customer portal

#### **User Experience**
- **Seamless Upgrades**: Instant plan changes with prorated billing
- **Transparent Billing**: Clear invoices and payment history
- **Self-Service**: Users manage subscriptions without support intervention
- **Mobile Optimized**: Works perfectly on all devices

### 🔧 Detailed Implementation Breakdown

#### **1. Stripe Products & Pricing Setup**

**Products to Create:**
```bash
Product: "Archivist Pro"
├── Price: "Monthly Plan" ($20/month, recurring)
├── Price: "Annual Plan" ($200/year, recurring)  
└── Price: "Lifetime Plan" ($500, one-time)
```

**Price IDs for Code:**
```typescript
const STRIPE_PRICES = {
  monthly: 'price_1ABC123...', // Your actual Stripe Price ID
  annual: 'price_1DEF456...',
  lifetime: 'price_1GHI789...'
}
```

#### **2. Enhanced Edge Functions**

**Three Functions Required:**

1. **`checkout`** (Enhanced)
   ```typescript
   // Change from one-time to subscription mode
   const session = await stripe.checkout.sessions.create({
     payment_method_types: ['card'],
     line_items: [{ price: getPriceId(plan) }],
     mode: 'subscription', // Changed from 'payment'
     success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
     cancel_url: cancelUrl,
     metadata: { plan, user_id, email },
     subscription_data: {
       metadata: { user_id, plan }
     }
   })
   ```

2. **`webhook`** (Enhanced)
   ```typescript
   // Add subscription event handlers
   switch (event.type) {
     case 'checkout.session.completed':
     case 'customer.subscription.created':
     case 'customer.subscription.updated':
     case 'customer.subscription.deleted':
     case 'invoice.payment_succeeded':
     case 'invoice.payment_failed':
     case 'invoice.payment_action_required':
   }
   ```

3. **`create-portal-session`** (New)
   ```typescript
   // Create Customer Portal sessions
   const session = await stripe.billingPortal.sessions.create({
     customer: customerId,
     return_url: 'app://account'
   })
   ```

#### **3. Database Schema Extensions**

**New Fields to Add:**
```sql
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS payment_failed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_payment_failure TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMP WITH TIME ZONE;

-- Index for subscription queries
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription_id ON public.profiles(stripe_subscription_id);
```

#### **4. Webhook Event Handlers**

**Subscription Lifecycle Management:**
```typescript
async function handleSubscriptionCreated(subscription: any) {
  const { user_id, plan } = subscription.metadata
  const subscriptionEndsAt = new Date(subscription.current_period_end * 1000).toISOString()
  
  await supabase.from('profiles').update({
    plan: plan,
    access_granted: true,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    subscription_ends_at: subscriptionEndsAt,
    trial_ends_at: null
  }).eq('id', user_id)
}

async function handleSubscriptionUpdated(subscription: any) {
  const { user_id, plan } = subscription.metadata
  const updates: any = {
    plan: plan,
    subscription_ends_at: new Date(subscription.current_period_end * 1000).toISOString()
  }
  
  if (subscription.status === 'canceled') {
    updates.access_granted = false // Will be revoked at period end
  }
  
  await supabase.from('profiles').update(updates).eq('id', user_id)
}

async function handleInvoicePaymentSucceeded(invoice: any) {
  const subscription = invoice.subscription
  const { user_id } = subscription.metadata
  const newEndDate = new Date(subscription.current_period_end * 1000).toISOString()
  
  await supabase.from('profiles').update({
    access_granted: true,
    last_payment_date: new Date().toISOString(),
    subscription_ends_at: newEndDate,
    payment_failed: false
  }).eq('id', user_id)
}

async function handleInvoicePaymentFailed(invoice: any) {
  const subscription = invoice.subscription
  const { user_id } = subscription.metadata
  
  // Implement grace period logic
  const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  
  await supabase.from('profiles').update({
    payment_failed: true,
    last_payment_failure: new Date().toISOString(),
    grace_period_ends_at: gracePeriodEndsAt
  }).eq('id', user_id)
}
```

#### **5. Frontend Integration**

**Account Page Updates:**
```typescript
// Add "Manage Billing" button
const handleManageBilling = async () => {
  if (!user?.stripe_customer_id) return
  
  const response = await fetch('/api/create-portal-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: user.stripe_customer_id })
  })
  
  const { url } = await response.json()
  window.open(url, '_blank')
}

// Enhanced subscription status display
const getSubscriptionStatus = () => {
  if (userSubscription.payment_failed) {
    return 'Payment Failed - Grace Period Active'
  }
  if (userSubscription.is_subscribed) {
    return `Active - ${userSubscription.plan} Plan`
  }
  return 'No Active Subscription'
}
```

#### **6. Plan Change Implementation**

**Upgrade/Downgrade Logic:**
```typescript
// In your app or via Customer Portal
const handlePlanChange = async (newPlan: string) => {
  const response = await fetch('/api/change-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriptionId: user.stripe_subscription_id,
      newPlan: newPlan
    })
  })
  
  // Stripe handles proration automatically
  // Webhook will update database
}

// Edge function for plan changes
const session = await stripe.subscriptions.update(subscriptionId, {
  items: [{ id: currentItemId, price: getPriceId(newPlan) }],
  proration_behavior: 'create_prorations'
})
```

#### **7. Failed Payment Recovery**

**No Grace Period Implementation:**
```typescript
// Immediate lockout on payment failure
const hasAccess = (user: any) => {
  if (user.payment_failed) return false
  if (user.is_subscribed) return true
  return false
}

// Payment failure handling
const handlePaymentFailure = async (user: any) => {
  await supabase.from('profiles').update({
    access_granted: false,
    payment_failed: true,
    last_payment_failure: new Date().toISOString()
  }).eq('id', user.id)
}
```

**Benefits of No Grace Period:**
- **Simpler implementation** - no grace period logic needed
- **Clear user expectations** - pay or lose access immediately
- **Better cash flow** - no extended access without payment
- **Reduces complexity** - fewer edge cases to handle

#### **8. Migration Strategy**

**Phase 1: Setup (1-2 hours)**
- Create Stripe products and prices
- Update checkout function to subscription mode
- Test with new users

**Phase 2: Enhanced Webhooks (30 minutes)**
- Add subscription event handlers
- Test recurring payment flow
- Implement failed payment handling

**Phase 3: Real-time Updates (30 minutes)**
- Enable real-time in Supabase project
- Add real-time subscription listener to app
- Test automatic app updates
- Configure connection monitoring

**Phase 4: Customer Portal (15 minutes)**
- Deploy create-portal-session function
- Add "Manage Billing" button to UI
- Test portal functionality

**Phase 5: Migration (Optional)**
- Create Stripe subscriptions for existing users
- Update database with subscription IDs
- Test complete lifecycle

#### **9. Testing Scenarios**

**Happy Path:**
1. User subscribes to monthly plan
2. Payment succeeds, subscription created
3. Monthly payment processes automatically
4. User upgrades to annual plan
5. Prorated billing applied
6. User cancels subscription
7. Access continues until period end

**Error Scenarios:**
1. Payment fails on initial subscription
2. Recurring payment fails
3. Card expires mid-subscription
4. User cancels during grace period
5. Network issues during webhook processing

#### **10. Real-time App Updates**

**Real-time Database Updates:**
The subscription system uses Supabase's real-time functionality to automatically update the app when subscription changes occur, ensuring users always see current subscription status without manual refresh.

**How It Works:**
1. **Payment Completion**: User pays in browser → Stripe webhook updates database
2. **Real-time Detection**: App listener detects database change immediately
3. **Automatic Refresh**: UI updates to show new subscription status
4. **Seamless Experience**: No manual intervention required

**Benefits:**
- **Reliability**: Works regardless of how database was updated
- **Completeness**: Catches ALL subscription changes (payments, plan changes, cancellations)
- **User Experience**: Instant updates without user action
- **Scalability**: Works for any number of users efficiently

**Implementation:**
```typescript
// Real-time subscription listener
const subscription = supabaseClient
  .channel('subscription-changes')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
    filter: `id=eq.${user?.id}`
  }, (payload) => {
    console.log('Subscription updated via real-time:', payload);
    refreshSubscription(); // Refresh local state
  })
  .subscribe();
```

**Real-world Scenarios:**
- **New Subscription**: User pays → Webhook updates database → App shows "Active Subscription"
- **Plan Upgrade**: User changes plan in Customer Portal → App shows new plan immediately
- **Payment Failure**: Stripe fails to charge → App shows "Payment Failed" status
- **Admin Changes**: Manual subscription updates → App reflects changes immediately

**Edge Cases Handled:**
- Network issues with automatic reconnection
- Multiple app tabs staying in sync
- App restarts fetching current state
- Graceful degradation if real-time unavailable

#### **11. Monitoring & Analytics**

**Key Metrics to Track:**
- Subscription creation rate
- Payment success/failure rates
- Plan change frequency
- Cancellation rate
- Grace period usage
- Customer portal usage
- Real-time connection status
- App update success rate

**Webhook Monitoring:**
```typescript
// Log all webhook events for debugging
console.log('Webhook event:', {
  type: event.type,
  id: event.id,
  object: event.data.object.id,
  timestamp: new Date().toISOString()
})
```

**Real-time Monitoring:**
```typescript
// Monitor real-time connection status
subscription.on('connect', () => {
  console.log('Real-time connected');
});

subscription.on('disconnect', () => {
  console.log('Real-time disconnected');
});
```

---

## NEW PAYMENT SYSTEM (Active)

### Overview

The new payment system uses Supabase Edge Functions to handle Stripe checkout, eliminating the need for complex client-side payment processing. This approach provides better reliability, security, and user experience.

### Architecture

#### Components

1. **Supabase Edge Functions**
   - `checkout` function: Creates Stripe sessions and redirects
   - `webhook` function: Receives payment confirmations and updates database

2. **Desktop App**
   - Opens browser for payment (no webview)
   - Handles deep link callbacks (`archivist://success`)
   - Refreshes subscription data after payment

3. **Stripe**
   - Hosts checkout pages
   - Processes payments
   - Sends webhooks to Supabase
   - Handles success/cancel redirects

### Payment Flow

#### 1. Plan Selection
```
User → Account Page → PlanSelection → Select Plan → Browser Opens
```

#### 2. Stripe Checkout
```
Browser → Supabase checkout function → Stripe checkout page → User completes payment
```

#### 3. Payment Processing
```
Stripe → Processes payment → Sends webhook → Supabase webhook function → Database update
```

#### 4. Success Redirect
```
Stripe → Success page → archivist://success → Desktop app → Subscription refresh
```

### Benefits

- **Reliability**: Server-side webhooks eliminate client-side failures
- **Security**: Stripe handles all payment security
- **Simplicity**: Minimal code to maintain
- **User Experience**: Standard web checkout flow
- **Cost**: Free hosting via Supabase Edge Functions

### Implementation Status

- [ ] Create Supabase Edge Functions
- [ ] Configure Stripe webhooks
- [ ] Update desktop app for browser redirects
- [ ] Test complete payment flow
- [ ] Remove old webview system

---

## LEGACY PAYMENT SYSTEM (Dormant)

**Note**: The below payment system is dormant but code is still in place to revive it.

### Overview

The payment system integrates Stripe checkout with Supabase user management to handle subscription upgrades. Users can select a plan, complete payment via Stripe, and have their subscription status updated in the database.

## Architecture

### Components

1. **PlanSelection** (`app/src/components/PlanSelection.tsx`)
   - Displays available pricing plans
   - Handles plan selection and checkout initiation

2. **PaymentWebview** (`app/src/components/PaymentWebview.tsx`)
   - Renders Stripe checkout in Electron webview
   - Monitors URL changes to detect success/cancellation
   - Extracts plan and session data from redirect URLs

3. **Account Page** (`app/src/pages/Account.tsx`)
   - Orchestrates the payment flow
   - Manages payment state and UI feedback
   - Handles success/cancellation callbacks

4. **SubscriptionContext** (`app/src/contexts/SubscriptionContext.tsx`)
   - Manages subscription state across the app
   - Handles database updates after successful payment
   - Provides subscription status and feature access

5. **Supabase Database** (`supabase-schema.sql`)
   - Stores user profiles with subscription data
   - Row-Level Security (RLS) policies for data protection

## Payment Flow

### 1. Plan Selection
```
User → Account Page → PlanSelection → Select Plan → Checkout
```

### 2. Stripe Checkout
```
Checkout → PaymentWebview → Stripe URL → User completes payment
```

### 3. Success Detection
```
Stripe redirects to: https://rmacfarlane24.github.io/archivist-success/?plan=monthly&session_id=cs_test_...
PaymentWebview detects URL change → Extracts plan & session_id → Calls onPaymentSuccess
```

### 4. Database Update
```
onPaymentSuccess → updateSubscriptionAfterPayment() → Supabase client update
Updates profiles table:
- plan: 'monthly'/'annual'/'lifetime'
- access_granted: true
- last_payment_date: current timestamp
- stripe_customer_id: session_id
- subscription_ends_at: calculated end date
- trial_ends_at: null (clears trial)
```

### 5. UI Refresh
```
Database update → refreshSubscription() → UI shows new plan status
```

## Data Flow

### Frontend → Stripe
- User selects plan in UI
- Plan ID passed to PaymentWebview
- Stripe URL includes prefilled email
- User completes payment on Stripe

### Stripe → Frontend
- Stripe redirects to success page with plan and session_id
- PaymentWebview detects redirect and extracts parameters
- Success callback triggered with plan and session data

### Frontend → Database
- Supabase client authenticated with user session
- Profile updated using user's UUID
- RLS policies ensure user can only update their own profile

### Database → UI
- Subscription context fetches updated profile data
- UI components reflect new subscription status
- Feature access granted based on plan

## Key Files

### Configuration
- `app/src/types/subscription.ts` - Plan definitions and Stripe URLs
- `supabase-schema.sql` - Database schema and RLS policies

### Components
- `app/src/components/PaymentWebview.tsx` - Stripe checkout interface
- `app/src/components/PlanSelection.tsx` - Plan selection UI
- `app/src/pages/Account.tsx` - Payment orchestration

### Context & Logic
- `app/src/contexts/SubscriptionContext.tsx` - Subscription state management
- `app/src/contexts/AuthContext.tsx` - Authentication state
- `app/src/supabase-client.ts` - Supabase client configuration

## Authentication Integration

### Session Management
- Electron manages authentication state
- Supabase client synced with Electron session via `setSession()`
- User UUID used for all database operations

### RLS Policies
```sql
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
```

## Error Handling

### Current Error Handling
- Database operation errors logged and thrown
- UI shows error states for failed operations
- Payment cancellation properly handled

### Error Recovery
- Failed database updates don't affect Stripe payment
- User can retry payment if database update fails
- Authentication errors prevent database operations

## Robustness Concerns

### 1. Network Resilience ⚠️
**Issue**: No retry logic for failed database updates
**Risk**: Network hiccups could cause payment to fail even if Stripe succeeded
**Impact**: User pays but doesn't get subscription access
**Solution Needed**: Add retry mechanism with exponential backoff

### 2. Payment Verification ⚠️
**Issue**: No verification that Stripe payment actually succeeded
**Risk**: Could update subscription based on URL redirect without confirming payment
**Impact**: User could get subscription access without paying
**Solution Needed**: Verify payment with Stripe webhook or session validation

### 3. Race Conditions ⚠️
**Issue**: Multiple rapid payment attempts could cause conflicts
**Risk**: Database could end up in inconsistent state
**Impact**: Duplicate charges or corrupted subscription data
**Solution Needed**: Add payment state locking/queuing

### 4. Timeout Handling ⚠️
**Issue**: No timeout for database operations
**Risk**: User could be left hanging if database is slow
**Impact**: Poor user experience, potential UI freezes
**Solution Needed**: Add operation timeouts with user feedback

### 5. Rollback Mechanism ⚠️
**Issue**: No way to undo subscription updates if something goes wrong
**Risk**: Could leave user in bad state if error occurs mid-update
**Impact**: User might lose access or have incorrect billing
**Solution Needed**: Transaction-based updates or rollback capability

### 6. Stripe Session Validation ⚠️
**Issue**: Relying only on URL parameters for payment confirmation
**Risk**: URL could be manipulated or payment could be disputed
**Impact**: False positive payment confirmations
**Solution Needed**: Server-side webhook validation

### 7. Concurrent User Sessions ⚠️
**Issue**: No handling of multiple browser tabs/windows
**Risk**: Payment state could conflict between sessions
**Impact**: Inconsistent subscription state across sessions
**Solution Needed**: Session-aware payment state management

### 8. Database Connection Failures ⚠️
**Issue**: No handling of Supabase connection issues
**Risk**: Payment succeeds but database update fails
**Impact**: User pays but doesn't get access
**Solution Needed**: Connection health checks and fallback mechanisms

## Testing Scenarios

### Happy Path
1. User selects plan
2. Completes Stripe payment
3. Database updates successfully
4. UI reflects new subscription

### Error Scenarios
1. Network failure during database update
2. Stripe payment failure
3. User cancellation
4. Database connection timeout
5. Authentication failure

## Monitoring & Logging

### Current Logging
- Payment success/failure events
- Database operation results
- Authentication state changes
- Error details with stack traces

### Monitoring Needed
- Payment success rates
- Database update failure rates
- Network timeout frequency
- User cancellation rates

## Future Improvements

### High Priority
1. Implement Stripe webhook validation
2. Add retry logic for database operations
3. Add operation timeouts

### Medium Priority
4. Implement payment state locking
5. Add rollback mechanisms
6. Improve error recovery

### Low Priority
7. Add detailed payment analytics
8. Implement A/B testing for checkout flows
9. Add subscription management features

### Future Enhancement: Subscription Schedules
**Complexity**: High (8-12 hours implementation)
**When to implement**: After gaining user feedback and usage patterns

#### What Subscription Schedules Add
- **Scheduled plan changes** that take effect at end of billing period
- **No immediate proration** - cleaner user experience
- **Professional plan switching** via Customer Portal
- **Automatic phase transitions** without manual intervention

#### Additional Implementation Required
1. **New API Integration**
   - Subscription Schedule API (separate from Subscriptions API)
   - Handle `subscription_schedule.created`, `subscription_schedule.released` webhooks
   - Manage schedule vs direct subscription updates

2. **Database Schema Extensions**
   - Add `subscription_schedule_id` field to profiles table
   - Track schedule phases and transitions
   - Store schedule metadata for future updates

3. **Enhanced Webhook Logic**
   - Handle schedule creation when users downgrade
   - Handle schedule releases when schedules complete
   - Prevent conflicts between schedule and direct updates
   - Manage Customer Portal automatic schedule creation

4. **Complex Edge Cases**
   - User upgrades while schedule is pending
   - Schedule modifications and cancellations
   - Cleanup when schedules are released
   - Conflict resolution between different update methods

#### Current Approach vs Subscription Schedules
- **Current**: Cancel & re-subscribe (simple, immediate)
- **Schedules**: Professional plan switching (complex, scheduled)

#### Recommendation
Start with cancel & re-subscribe approach. Add subscription schedules later when:
- Users specifically request plan switching
- You have more development time available
- You understand usage patterns better
- Revenue justifies the complexity
