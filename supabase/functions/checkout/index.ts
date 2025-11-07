import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

// Stripe configuration - TEST KEYS ONLY
const STRIPE_SECRET_KEY_TEST = Deno.env.get('STRIPE_SECRET_KEY_TEST')
const STRIPE_PUBLISHABLE_KEY_TEST = Deno.env.get('STRIPE_PUBLISHABLE_KEY_TEST')

// Plan configurations with TEST price IDs
const PLANS = {
  monthly: {
    price_id: 'price_1S2XvCL7piPaCCe99LmhoiKR',
    amount: 500,
    currency: 'gbp'
  },
  annual: {
    price_id: 'price_1S2XvXL7piPaCCe9LTGy8uJO',
    amount: 5000,
    currency: 'gbp'
  },
  lifetime: {
    price_id: 'price_1S2Xw3L7piPaCCe9feBL8ZKg',
    amount: 10000,
    currency: 'gbp'
  }
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('=== CHECKOUT FUNCTION CALLED ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', Object.fromEntries(req.headers.entries()))

  // Check for authorization header
  const authHeader = req.headers.get('authorization')
  console.log('Authorization header present:', !!authHeader)
  if (authHeader) {
    console.log('Authorization header value:', authHeader.substring(0, 20) + '...')
  }

  try {
    // Parse the request body
    const body = await req.json()
    console.log('Request body:', body)
    
    const { plan, user_id, email } = body

    // Validate required parameters
    if (!plan || !user_id || !email) {
      console.error('Missing required parameters:', { plan, user_id, email })
      return new Response(JSON.stringify({
        error: 'Missing required parameters: plan, user_id, email',
        received: { plan, user_id, email }
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Validate plan type
    const validPlans = ['monthly', 'annual', 'lifetime']
    if (!validPlans.includes(plan)) {
      console.error('Invalid plan:', plan)
      return new Response(JSON.stringify({
        error: `Invalid plan: ${plan}. Must be one of: ${validPlans.join(', ')}`,
        received_plan: plan
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Validate Stripe configuration
    if (!STRIPE_SECRET_KEY_TEST) {
      console.error('Missing STRIPE_SECRET_KEY_TEST environment variable')
      return new Response(JSON.stringify({
        error: 'Server configuration error: STRIPE_SECRET_KEY_TEST not set',
        message: 'Please configure Stripe test keys in Supabase environment variables'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('Stripe secret key present:', !!STRIPE_SECRET_KEY_TEST)
    console.log('Stripe secret key starts with:', STRIPE_SECRET_KEY_TEST?.substring(0, 7))

    // Get plan configuration
    const planConfig = PLANS[plan];
    if (!planConfig) {
      console.error('Plan configuration not found for:', plan)
      return new Response(JSON.stringify({
        error: `Plan configuration not found: ${plan}`,
        available_plans: Object.keys(PLANS)
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('Plan config:', planConfig);

    // Determine mode based on plan type
    const mode = plan === 'lifetime' ? 'payment' : 'subscription';
    console.log('Using mode:', mode);

    // Create Stripe checkout session
    console.log('Creating Stripe checkout session...')
    console.log('Stripe API URL: https://api.stripe.com/v1/checkout/sessions')
    console.log('Price ID:', planConfig.price_id)
    console.log('Customer email:', email)
    console.log('User ID:', user_id)

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY_TEST}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price]': planConfig.price_id,
        'line_items[0][quantity]': '1',
        'mode': mode,
        'success_url': 'https://rmacfarlane24.github.io/archivist-success/',
        'customer_email': email,
        'metadata[plan]': plan,
        'metadata[user_id]': user_id,
        'metadata[email]': email
      })
    });

    console.log('Stripe response status:', stripeResponse.status);
    console.log('Stripe response headers:', Object.fromEntries(stripeResponse.headers.entries()));

    if (!stripeResponse.ok) {
      const stripeError = await stripeResponse.text();
      console.error('Stripe API error status:', stripeResponse.status);
      console.error('Stripe API error details:', stripeError);
      
      return new Response(JSON.stringify({
        error: 'Failed to create checkout session',
        stripe_status: stripeResponse.status,
        stripe_error: stripeError,
        message: 'Check Stripe configuration and price IDs',
        debug_info: {
          price_id: planConfig.price_id,
          plan: plan,
          email: email,
          user_id: user_id
        }
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const stripeData = await stripeResponse.json();
    console.log('Stripe checkout session created successfully');
    console.log('Session ID:', stripeData.id);
    console.log('Checkout URL:', stripeData.url);
    console.log('Session data:', stripeData);

    // Return the checkout URL for redirect
    return new Response(JSON.stringify({
      success: true,
      checkout_url: stripeData.url,
      session_id: stripeData.id,
      plan: plan,
      user_id: user_id,
      message: 'Checkout session created successfully'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Unexpected error in checkout function:', error)
    console.error('Error stack:', error.stack)
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message,
        stack: error.stack
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})