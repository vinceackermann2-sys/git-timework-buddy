import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { dispatchEmailQueue } from '../_shared/emailQueue.ts'
import { enqueueEmail } from '../_shared/queuedEmail.ts'
import { createMessages, type HookPayload } from './messages.ts'

const FROM_EMAIL = Deno.env.get('TIMEWARP_EMAIL_FROM') || 'Timewarp <noreply@agents.timewarpdev.com>'

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const configuredSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || ''
  if (!configuredSecret) {
    console.error('SEND_EMAIL_HOOK_SECRET is not configured')
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rawBody = await request.text()
  let payload: HookPayload
  try {
    const webhook = new Webhook(configuredSecret.replace(/^v1,whsec_/, ''))
    payload = webhook.verify(rawBody, Object.fromEntries(request.headers)) as HookPayload
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Auth email hook signature verification failed', { error: message })
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const messages = createMessages(payload)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase service configuration is missing')
    const admin = createClient(supabaseUrl, serviceRoleKey)
    const webhookId = request.headers.get('webhook-id') || crypto.randomUUID()

    for (const message of messages) {
      const html = await renderAsync(message.element)
      const text = await renderAsync(message.element, { plainText: true })
      const messageId = message.suffix ? `${webhookId}/${message.suffix}` : webhookId
      await enqueueEmail(admin, {
        queueName: 'auth_emails',
        messageId,
        idempotencyKey: `auth/${messageId}`,
        to: message.recipient,
        from: FROM_EMAIL,
        subject: message.subject,
        html,
        text,
        label: message.label,
      })
    }

    await dispatchEmailQueue()
    console.log('Auth email queued', { action: payload.email_data.email_action_type, count: messages.length })
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Auth email hook failed', { error: message })
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
