import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Configuration: Disable JWT verification for this function
// This allows the function to be called without authentication
// The function uses service role key for database access

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Add some basic logging
  console.log('Function called with method:', req.method)
  console.log('Function called with headers:', Object.fromEntries(req.headers.entries()))

  try {
    // Parse the request body
    const body = await req.json()
    console.log('Function called with body:', body)
    
    const { plan, session_id } = body

    // Validate required parameters
    if (!plan || !session_id) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required parameters: plan, session_id' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Extract email and plan from session_id if it's in the format from Stripe success redirect
    let email = null;
    let extractedPlan = plan; // Default to the plan passed in the request
    
    console.log('Processing session_id:', session_id);
    
    // Check if session_id contains email parameter
    if (session_id.includes('email=')) {
      const emailMatch = session_id.match(/email=([^&]+)/);
      if (emailMatch) {
        email = decodeURIComponent(emailMatch[1]);
        console.log('Extracted email from session_id:', email);
      }
    }
    
    // Check if session_id contains plan parameter
    if (session_id.includes('plan=')) {
      const planMatch = session_id.match(/plan=([^&]+)/);
      if (planMatch) {
        extractedPlan = decodeURIComponent(planMatch[1]);
        console.log('Extracted plan from session_id:', extractedPlan);
      }
    }

    // If no email found in session_id, try to get it from the request body
    if (!email && body.email) {
      email = body.email;
      console.log('Using email from request body:', email);
    }

    if (!email) {
      return new Response(
        JSON.stringify({ 
          error: 'Could not determine email from session_id or request body' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }



    // Validate plan type
    const validPlans = ['monthly', 'annual', 'lifetime']
    if (!validPlans.includes(extractedPlan)) {
      return new Response(
        JSON.stringify({ 
          error: `Invalid plan: ${extractedPlan}. Must be one of: monthly, annual, lifetime` 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables')
      return new Response(
        JSON.stringify({ 
          error: 'Server configuration error' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Create Supabase client with service role key for admin access
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Calculate subscription end date based on plan
    let subscriptionEndsAt = null
    if (extractedPlan !== 'lifetime') {
      const now = new Date()
      const daysToAdd = extractedPlan === 'monthly' ? 30 : 365
      subscriptionEndsAt = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString()
    }

    // Update the user's profile in the profiles table
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        email: email,
        plan: extractedPlan,
        access_granted: true,
        last_payment_date: new Date().toISOString(),
        stripe_customer_id: session_id,
        subscription_ends_at: subscriptionEndsAt,
        // Clear trial end date since they now have paid access
        trial_ends_at: null
      }, {
        onConflict: 'email'
      })

    if (error) {
      console.error('Error updating subscription:', error)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to update subscription',
          details: error.message 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Subscription updated successfully for ${extractedPlan} plan`,
        plan: extractedPlan,
        email: email,
        session_id: session_id,
        subscription_ends_at: subscriptionEndsAt
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
