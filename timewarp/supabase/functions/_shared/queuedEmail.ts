interface QueuedEmailOptions {
  queueName?: 'auth_emails' | 'transactional_emails'
  messageId?: string
  idempotencyKey?: string
  to: string
  from: string
  replyTo?: string
  subject: string
  html: string
  text: string
  label: string
}

// Names reserved for documentation and tests (RFC 2606, RFC 6761) can never
// receive mail. The provider rejects some outright and others bounce, and
// bounces count against the sender's reputation, so these are logged and not
// sent.
export const reservedEmailDomain = (address: string) => {
  const domain = String(address).trim().toLowerCase().split('@').pop() || ''
  return /(^|\.)example\.(com|net|org)$/.test(domain) || /(^|\.)(test|example|invalid|localhost)$/.test(domain)
}

export const enqueueEmail = async (admin: any, options: QueuedEmailOptions) => {
  const messageId = options.messageId || crypto.randomUUID()
  const queueName = options.queueName || 'transactional_emails'

  if (reservedEmailDomain(options.to)) {
    await admin.from('email_send_log').insert({
      message_id: messageId,
      template_name: options.label,
      recipient_email: options.to,
      status: 'suppressed',
      error_message: 'Reserved test domain: not sent',
    })
    return messageId
  }

  const { error: logError } = await admin.from('email_send_log').insert({
    message_id: messageId,
    template_name: options.label,
    recipient_email: options.to,
    status: 'pending',
  })
  if (logError) throw logError

  const { error: enqueueError } = await admin.rpc('enqueue_email', {
    queue_name: queueName,
    payload: {
      message_id: messageId,
      idempotency_key: options.idempotencyKey || `timewarp/${messageId}`,
      to: options.to,
      from: options.from,
      ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      subject: options.subject,
      html: options.html,
      text: options.text,
      purpose: 'transactional',
      label: options.label,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    await admin.from('email_send_log').insert({
      message_id: messageId,
      template_name: options.label,
      recipient_email: options.to,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    throw enqueueError
  }

  return messageId
}
