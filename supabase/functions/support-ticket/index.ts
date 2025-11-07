/// <reference path="./types.d.ts" />
// @ts-ignore: Deno edge function runtime supports URL imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('=== SUPPORT TICKET FUNCTION CALLED ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse request body
    const { userId, email, subject, message } = await req.json()
    console.log('Support ticket data:', { userId, email, subject, message })

    // Validate required fields
    if (!userId || !email || !subject || !message) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields',
        required: ['userId', 'email', 'subject', 'message']
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get environment variables
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL') || 'support@archivist.app'

    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured')
      return new Response(JSON.stringify({ 
        error: 'Email service not configured' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Prepare email content
    const emailSubject = `[Archivist Support] ${subject}`
    const emailBody = `
New support ticket from Archivist user:

User ID: ${userId}
User Email: ${email}
Subject: ${subject}

Message:
${message}

---
Sent from Archivist Support System
Timestamp: ${new Date().toISOString()}
    `.trim()

    // Send email via Resend
    console.log('Sending email via Resend...')
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Archivist Support <onboarding@resend.dev>',
        to: [SUPPORT_EMAIL],
        subject: emailSubject,
        text: emailBody,
        reply_to: email // Allow replying directly to the user
      }),
    })

    const resendData = await resendResponse.json()
    console.log('Resend response:', resendData)

    if (!resendResponse.ok) {
      console.error('Resend API error:', resendData)
      return new Response(JSON.stringify({ 
        error: 'Failed to send support email',
        details: resendData
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Send confirmation email to user
    console.log('Sending confirmation email to user...')
    const confirmationResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Archivist Support <onboarding@resend.dev>',
        to: [email],
        subject: 'Support Request Received - Archivist',
        text: `Hi there,

We've received your support request and will get back to you within 24 hours.

Your request details:
Subject: ${subject}
Message: ${message}

If you have any additional information to add, please reply to this email.

Best regards,
Archivist Support Team`,
        html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #2563eb;">Support Request Received</h2>
  <p>Hi there,</p>
  <p>We've received your support request and will get back to you within 24 hours.</p>
  
  <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <h3 style="margin-top: 0;">Your request details:</h3>
    <p><strong>Subject:</strong> ${subject}</p>
    <p><strong>Message:</strong><br>${message.replace(/\n/g, '<br>')}</p>
  </div>
  
  <p>If you have any additional information to add, please reply to this email.</p>
  
  <p>Best regards,<br>Archivist Support Team</p>
</div>`
      }),
    })

    const confirmationData = await confirmationResponse.json()
    console.log('Confirmation email response:', confirmationData)

    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      ticketId: resendData.id,
      message: 'Support request sent successfully'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Support ticket error:', error)
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})