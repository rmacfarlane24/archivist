import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

// Stripe configuration - TEST KEYS ONLY
const STRIPE_SECRET_KEY_TEST = Deno.env.get('STRIPE_SECRET_KEY_TEST')

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('=== CREATE PORTAL SESSION FUNCTION CALLED ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)

  try {
    // Parse the request body
    const body = await req.json()
    console.log('Request body:', body)
    
    const { customerId } = body

    // Validate required parameters
    if (!customerId) {
      console.error('Missing customerId parameter')
      return new Response(JSON.stringify({
        error: 'Missing required parameter: customerId'
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
        error: 'Server configuration error: STRIPE_SECRET_KEY_TEST not set'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('Creating Customer Portal session for customer:', customerId)

    // Create Stripe Customer Portal session
    const stripeResponse = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY_TEST}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'customer': customerId,
        'return_url': 'https://archivist.app' // Placeholder URL
      })
    });

    console.log('Stripe response status:', stripeResponse.status);

    if (!stripeResponse.ok) {
      const stripeError = await stripeResponse.text();
      console.error('Stripe API error:', stripeError);
      
      return new Response(JSON.stringify({
        error: 'Failed to create portal session',
        stripe_error: stripeError
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const stripeData = await stripeResponse.json();
    console.log('Customer Portal session created successfully');
    console.log('Portal URL:', stripeData.url);

    // Return the portal URL for redirect
    return new Response(JSON.stringify({
      success: true,
      portal_url: stripeData.url,
      customer_id: customerId,
      message: 'Customer Portal session created successfully'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Unexpected error in create-portal-session function:', error)
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
