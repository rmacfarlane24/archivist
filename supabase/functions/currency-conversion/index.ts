/// <reference path="./types.d.ts" />
// @ts-ignore: Deno edge function runtime supports URL imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
}

interface CurrencyRate {
  currency: string;
  rate: number;
}

interface ConversionResponse {
  success: boolean;
  rates?: CurrencyRate[];
  error?: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    // Note: This is a public endpoint for currency conversion rates
    // No authentication required as it only provides public exchange rates

    // Fetch current exchange rates from Stripe
    // Stripe doesn't have a direct currency conversion API, but we can use their 
    // exchange rates from the API or use a reliable third-party service
    
    // For now, let's use a reliable exchange rate API (exchangerate-api.com is free)
    const exchangeResponse = await fetch('https://api.exchangerate-api.com/v4/latest/GBP')
    
    if (!exchangeResponse.ok) {
      throw new Error('Failed to fetch exchange rates')
    }

    const exchangeData = await exchangeResponse.json()
    
    // Extract rates for currencies we support
    const supportedCurrencies = ['USD', 'EUR', 'GBP']
    const rates: CurrencyRate[] = supportedCurrencies.map(currency => ({
      currency,
      rate: currency === 'GBP' ? 1 : exchangeData.rates[currency] || 1
    }))

    return new Response(JSON.stringify({
      success: true,
      rates
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Currency conversion error:', error)
    
    // Fallback to static rates if API fails
    const fallbackRates: CurrencyRate[] = [
      { currency: 'GBP', rate: 1 },
      { currency: 'USD', rate: 1.27 },
      { currency: 'EUR', rate: 1.17 }
    ]

    return new Response(JSON.stringify({
      success: true,
      rates: fallbackRates
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})