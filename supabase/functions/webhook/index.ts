import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore - Deno import works at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

// Stripe configuration - TEST KEYS ONLY
const STRIPE_SECRET_KEY_TEST = Deno.env.get('STRIPE_SECRET_KEY_TEST')
const STRIPE_WEBHOOK_SECRET_TEST = Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST')

// Supabase configuration
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('=== WEBHOOK FUNCTION CALLED ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  
  // Log important headers for debugging
  const headerEntries: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headerEntries[key] = value
  })
  console.log('Headers:', headerEntries)

  try {
    // Get the raw body for webhook signature verification
    const body = await req.text()
    const signature = req.headers.get('stripe-signature')

    console.log('Webhook body length:', body.length)
    console.log('Stripe signature present:', !!signature)
    if (signature) {
      console.log('Stripe signature starts with:', signature.substring(0, 20) + '...')
    }

    // Validate environment variables
    if (!STRIPE_WEBHOOK_SECRET_TEST) {
      console.error('Missing STRIPE_WEBHOOK_SECRET_TEST environment variable')
      return new Response(JSON.stringify({
        error: 'Server configuration error: STRIPE_WEBHOOK_SECRET_TEST not set',
        message: 'Please configure Stripe webhook secret in Supabase environment variables'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return new Response(JSON.stringify({
        error: 'Server configuration error: Missing Supabase URL or service role key',
        message: 'Please configure Supabase environment variables'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify webhook signature if secret is configured
    if (STRIPE_WEBHOOK_SECRET_TEST && signature) {
      try {
        // Note: In a production environment, you should use Stripe's webhook signature verification
        // For now, we'll log that verification would happen and continue
        console.log('Webhook signature verification would happen here')
        console.log('Webhook secret configured:', !!STRIPE_WEBHOOK_SECRET_TEST)
        
        // TODO: Implement proper signature verification
        // const event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET_TEST)
      } catch (err) {
        console.error('Webhook signature verification failed:', err)
        return new Response(JSON.stringify({
          error: 'Webhook signature verification failed',
          details: err.message
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    } else {
      console.warn('Webhook signature verification skipped - missing signature or secret')
    }

    // Parse the webhook event
    let event
    try {
      event = JSON.parse(body)
    } catch (err) {
      console.error('Failed to parse webhook body as JSON:', err)
      return new Response(JSON.stringify({
        error: 'Invalid webhook body format',
        details: err.message
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('Webhook event type:', event.type)
    console.log('Webhook event ID:', event.id)
    console.log('Webhook event object:', event.data?.object?.id)

    // Handle different webhook events
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('Processing checkout.session.completed event')
        await handleCheckoutSessionCompleted(event.data.object)
        break
      
      case 'customer.subscription.created':
        console.log('Processing customer.subscription.created event')
        await handleSubscriptionCreated(event.data.object)
        break
      
      case 'customer.subscription.deleted':
        console.log('Processing customer.subscription.deleted event')
        await handleSubscriptionDeleted(event.data.object)
        break
      
      case 'invoice.payment_succeeded':
        console.log('Processing invoice.payment_succeeded event')
        await handleInvoicePaymentSucceeded(event.data.object)
        break
      
      case 'invoice.payment_failed':
        console.log('Processing invoice.payment_failed event')
        await handleInvoicePaymentFailed(event.data.object)
        break
      
      case 'payment_intent.succeeded':
        console.log('Payment intent succeeded:', event.data.object.id)
        break
      
      case 'payment_intent.payment_failed':
        console.log('Payment intent failed:', event.data.object.id)
        break
      
      default:
        console.log('Unhandled webhook event type:', event.type)
        console.log('Event data:', event.data)
    }

    // Return success response to Stripe
    console.log('Webhook processed successfully')
    return new Response(
      JSON.stringify({ 
        received: true,
        event_type: event.type,
        event_id: event.id
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Webhook processing error:', error)
    console.error('Error stack:', error.stack)
    
    return new Response(
      JSON.stringify({ 
        error: 'Webhook processing failed',
        details: error.message,
        stack: error.stack
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

async function handleCheckoutSessionCompleted(session: any) {
  console.log('=== PROCESSING CHECKOUT SESSION COMPLETED ===')
  console.log('Session ID:', session.id)
  console.log('Session amount:', session.amount_total)
  console.log('Session currency:', session.currency)
  console.log('Session customer:', session.customer)
  console.log('Session metadata:', session.metadata)
  
  try {
    // Extract metadata from the session
    const { plan, user_id, email } = session.metadata || {}
    
    if (!plan || !user_id || !email) {
      console.error('Missing required metadata in session:', session.metadata)
      throw new Error(`Missing required metadata: plan=${plan}, user_id=${user_id}, email=${email}`)
    }

    console.log('Extracted metadata:', { plan, user_id, email })

    // Validate plan type
    const validPlans = ['monthly', 'annual', 'lifetime']
    if (!validPlans.includes(plan)) {
      console.error('Invalid plan in session metadata:', plan)
      throw new Error(`Invalid plan: ${plan}. Must be one of: ${validPlans.join(', ')}`)
    }

    // Validate Supabase configuration
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      throw new Error('Supabase configuration error: Missing URL or service role key')
    }

    console.log('Supabase URL configured:', !!SUPABASE_URL)
    console.log('Supabase service role key configured:', !!SUPABASE_SERVICE_ROLE_KEY)

    // Create Supabase client with service role key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Calculate subscription end date based on plan
    let subscriptionEndsAt = null
    if (plan !== 'lifetime') {
      const now = new Date()
      const daysToAdd = plan === 'monthly' ? 30 : 365
      subscriptionEndsAt = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString()
      console.log('Subscription ends at:', subscriptionEndsAt)
    } else {
      console.log('Lifetime plan - no expiration date')
    }

    console.log('Updating user subscription in database...')
    console.log('User ID:', user_id)
    console.log('Plan:', plan)
    console.log('Email:', email)
    console.log('Stripe customer ID:', session.customer || session.id)

    // Update the user's profile in the database using enhanced status system
    const { data, error } = await supabase
      .from('profiles')
      .update({
        plan: plan,
        subscription_status: 'active',
        access_granted: true,
        last_payment_date: new Date().toISOString(),
        stripe_customer_id: session.customer || session.id,
        subscription_ends_at: subscriptionEndsAt,
        payment_failed: false,
        last_payment_failure: null,
        grace_period_end: null,
        // Clear trial end date since they now have paid access
        trial_ends_at: null
      })
      .eq('id', user_id)
      .select()

    if (error) {
      console.error('Database update error:', error)
      console.error('Error details:', error.message)
      console.error('Error code:', error.code)
      throw new Error(`Failed to update subscription: ${error.message}`)
    }

    console.log('Subscription updated successfully in database')
    console.log('Updated profile data:', data)
    
    // Log the successful payment
    console.log('=== PAYMENT COMPLETED SUCCESSFULLY ===')
    console.log('Session ID:', session.id)
    console.log('User ID:', user_id)
    console.log('Plan:', plan)
    console.log('Amount:', session.amount_total)
    console.log('Currency:', session.currency)
    console.log('Customer ID:', session.customer)
    console.log('Payment status:', session.payment_status)

  } catch (error) {
    console.error('Error handling checkout session completion:', error)
    console.error('Error stack:', error.stack)
    // Re-throw the error so the webhook returns a failure response
    throw error
  }
}

async function handleSubscriptionCreated(subscription: any) {
  console.log('=== PROCESSING SUBSCRIPTION CREATED ===')
  console.log('Subscription ID:', subscription.id)
  console.log('Customer ID:', subscription.customer)
  console.log('Status:', subscription.status)
  console.log('Metadata:', subscription.metadata)
  
  try {
    const { user_id, plan } = subscription.metadata || {}
    
    if (!user_id || !plan) {
      console.error('Missing required metadata in subscription:', subscription.metadata)
      throw new Error(`Missing required metadata: user_id=${user_id}, plan=${plan}`)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // Calculate subscription end date based on plan
    let subscriptionEndsAt = null
    if (plan !== 'lifetime') {
      const now = new Date()
      const daysToAdd = plan === 'monthly' ? 30 : 365
      subscriptionEndsAt = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString()
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        plan: plan,
        subscription_status: 'active',
        access_granted: true,
        stripe_customer_id: subscription.customer,
        stripe_subscription_id: subscription.id,
        subscription_ends_at: subscriptionEndsAt,
        payment_failed: false,
        last_payment_failure: null,
        grace_period_end: null,
        trial_ends_at: null
      })
      .eq('id', user_id)
      .select()

    if (error) {
      console.error('Database update error:', error)
      throw new Error(`Failed to update subscription: ${error.message}`)
    }

    console.log('Subscription created successfully:', data)
  } catch (error) {
    console.error('Error handling subscription creation:', error)
    throw error
  }
}

async function handleSubscriptionDeleted(subscription: any) {
  console.log('=== PROCESSING SUBSCRIPTION DELETED ===')
  console.log('Subscription ID:', subscription.id)
  console.log('Customer ID:', subscription.customer)
  console.log('Metadata:', subscription.metadata)
  
  try {
    const { user_id } = subscription.metadata || {}
    
    if (!user_id) {
      console.error('Missing user_id in subscription metadata:', subscription.metadata)
      throw new Error('Missing user_id in subscription metadata')
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    const { data, error } = await supabase
      .from('profiles')
      .update({
        subscription_status: 'cancelled',
        access_granted: false,
        plan: 'free',
        stripe_subscription_id: null,
        subscription_ends_at: null,
        payment_failed: false,
        last_payment_failure: null,
        grace_period_end: null
      })
      .eq('id', user_id)
      .select()

    if (error) {
      console.error('Database update error:', error)
      throw new Error(`Failed to update subscription: ${error.message}`)
    }

    console.log('Subscription deleted successfully:', data)
  } catch (error) {
    console.error('Error handling subscription deletion:', error)
    throw error
  }
}

async function handleInvoicePaymentSucceeded(invoice: any) {
  console.log('=== PROCESSING INVOICE PAYMENT SUCCEEDED ===')
  console.log('Invoice ID:', invoice.id)
  console.log('Subscription ID:', invoice.subscription)
  console.log('Amount paid:', invoice.amount_paid)
  
  try {
    // Get subscription details to find user_id
    const subscription = invoice.subscription
    if (!subscription) {
      console.error('No subscription found in invoice')
      return
    }

    const { user_id } = subscription.metadata || {}
    if (!user_id) {
      console.error('No user_id found in subscription metadata')
      return
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // Calculate new subscription end date
    let subscriptionEndsAt = null
    if (subscription.items?.data?.[0]?.price?.recurring) {
      const interval = subscription.items.data[0].price.recurring.interval
      const now = new Date()
      const daysToAdd = interval === 'month' ? 30 : 365
      subscriptionEndsAt = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString()
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        subscription_status: 'active',
        access_granted: true,
        last_payment_date: new Date().toISOString(),
        subscription_ends_at: subscriptionEndsAt,
        payment_failed: false,
        last_payment_failure: null,
        grace_period_end: null
      })
      .eq('id', user_id)
      .select()

    if (error) {
      console.error('Database update error:', error)
      throw new Error(`Failed to update payment: ${error.message}`)
    }

    console.log('Payment succeeded, subscription updated:', data)
  } catch (error) {
    console.error('Error handling payment success:', error)
    throw error
  }
}

async function handleInvoicePaymentFailed(invoice: any) {
  console.log('=== PROCESSING INVOICE PAYMENT FAILED ===')
  console.log('Invoice ID:', invoice.id)
  console.log('Subscription ID:', invoice.subscription)
  console.log('Attempt count:', invoice.attempt_count)
  
  try {
    // Get subscription details to find user_id
    const subscription = invoice.subscription
    if (!subscription) {
      console.error('No subscription found in invoice')
      return
    }

    const { user_id } = subscription.metadata || {}
    if (!user_id) {
      console.error('No user_id found in subscription metadata')
      return
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // NO GRACE PERIOD - Immediate lockout on payment failure
    const { data, error } = await supabase
      .from('profiles')
      .update({
        subscription_status: 'overdue',
        access_granted: false,
        payment_failed: true,
        last_payment_failure: new Date().toISOString(),
        grace_period_end: null
      })
      .eq('id', user_id)
      .select()

    if (error) {
      console.error('Database update error:', error)
      throw new Error(`Failed to update payment failure: ${error.message}`)
    }

    console.log('Payment failed, access revoked immediately:', data)
  } catch (error) {
    console.error('Error handling payment failure:', error)
    throw error
  }
}
