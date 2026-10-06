import * as React from 'npm:react@18.3.1'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import {
  SecurityNotificationEmail,
  type SecurityNotificationType,
} from '../_shared/email-templates/security-notification.tsx'

type LinkAction = 'signup' | 'invite' | 'magiclink' | 'email' | 'recovery' | 'email_change'
type AuthEmailAction = LinkAction | 'reauthentication' | SecurityNotificationType

export interface HookPayload {
  user: {
    id: string
    email: string
    new_email?: string
    phone?: string
  }
  email_data: {
    token?: string
    token_hash?: string
    redirect_to?: string
    email_action_type: AuthEmailAction
    site_url?: string
    token_new?: string
    token_hash_new?: string
    old_email?: string
    old_phone?: string
    provider?: string
    factor_type?: string
  }
}

interface RenderedMessage {
  recipient: string
  subject: string
  label: string
  element: any
  suffix?: string
}

const SITE_NAME = 'Timewarp'
const SITE_URL = (Deno.env.get('TIMEWARP_SITE_URL') || 'https://timewarpdev.com').replace(/\/+$/, '')

const SUBJECTS: Record<AuthEmailAction, string> = {
  signup: 'Confirm your Timewarp email',
  invite: "You've been invited to Timewarp",
  magiclink: 'Your Timewarp sign-in link and code',
  email: 'Your Timewarp sign-in link and code',
  recovery: 'Reset your Timewarp password',
  email_change: 'Confirm your Timewarp email change',
  reauthentication: 'Your Timewarp verification code',
  password_changed_notification: 'Your Timewarp password was changed',
  email_changed_notification: 'Your Timewarp email was changed',
  phone_changed_notification: 'Your Timewarp phone number was changed',
  identity_linked_notification: 'A sign-in method was added to Timewarp',
  identity_unlinked_notification: 'A sign-in method was removed from Timewarp',
  mfa_factor_enrolled_notification: 'A verification method was added to Timewarp',
  mfa_factor_unenrolled_notification: 'A verification method was removed from Timewarp',
}

const SECURITY_ACTIONS = new Set<AuthEmailAction>([
  'password_changed_notification',
  'email_changed_notification',
  'phone_changed_notification',
  'identity_linked_notification',
  'identity_unlinked_notification',
  'mfa_factor_enrolled_notification',
  'mfa_factor_unenrolled_notification',
])

const confirmationUrl = (data: HookPayload['email_data'], tokenHash: string, action = data.email_action_type) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) throw new Error('SUPABASE_URL is not configured')
  const url = new URL(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/verify`)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', action)
  if (data.redirect_to) url.searchParams.set('redirect_to', data.redirect_to)
  return url.toString()
}

export const createMessages = (payload: HookPayload): RenderedMessage[] => {
  const { user, email_data: data } = payload
  const action = data.email_action_type
  const common = { siteName: SITE_NAME, siteUrl: SITE_URL }

  if (!user.email) throw new Error('Auth hook payload is missing the recipient email')
  if (!SUBJECTS[action]) throw new Error(`Unsupported auth email action: ${action}`)

  if (SECURITY_ACTIONS.has(action)) {
    return [{
      recipient: user.email,
      subject: SUBJECTS[action],
      label: action,
      element: React.createElement(SecurityNotificationEmail, {
        siteUrl: SITE_URL,
        actionType: action as SecurityNotificationType,
        email: user.email,
        oldEmail: data.old_email,
        phone: user.phone,
        oldPhone: data.old_phone,
        provider: data.provider,
        factorType: data.factor_type,
      }),
    }]
  }

  if (action === 'reauthentication') {
    if (!data.token) throw new Error('Reauthentication email is missing its token')
    return [{
      recipient: user.email,
      subject: SUBJECTS[action],
      label: action,
      element: React.createElement(ReauthenticationEmail, { ...common, token: data.token }),
    }]
  }

  if (action === 'email_change') {
    const newEmail = user.new_email || ''
    if (!newEmail) throw new Error('Email change hook is missing the new email address')

    // Supabase intentionally reverses the hash suffixes for backwards
    // compatibility: token_hash_new confirms the current address, while
    // token_hash confirms the new address.
    if (data.token_hash_new && data.token_hash) {
      return [
        {
          recipient: user.email,
          subject: SUBJECTS[action],
          label: 'email_change_current',
          suffix: 'current',
          element: React.createElement(EmailChangeEmail, {
            ...common,
            oldEmail: user.email,
            email: user.email,
            newEmail,
            confirmationUrl: confirmationUrl(data, data.token_hash_new, action),
          }),
        },
        {
          recipient: newEmail,
          subject: SUBJECTS[action],
          label: 'email_change_new',
          suffix: 'new',
          element: React.createElement(EmailChangeEmail, {
            ...common,
            oldEmail: user.email,
            email: newEmail,
            newEmail,
            confirmationUrl: confirmationUrl(data, data.token_hash, action),
          }),
        },
      ]
    }

    const tokenHash = data.token_hash || data.token_hash_new
    if (!tokenHash) throw new Error('Email change hook is missing its token hash')
    return [{
      recipient: newEmail,
      subject: SUBJECTS[action],
      label: action,
      element: React.createElement(EmailChangeEmail, {
        ...common,
        oldEmail: data.old_email || user.email,
        email: newEmail,
        newEmail,
        confirmationUrl: confirmationUrl(data, tokenHash, action),
      }),
    }]
  }

  if (!data.token_hash) throw new Error(`${action} email is missing its token hash`)
  const url = confirmationUrl(data, data.token_hash, action)
  const templateProps = { ...common, recipient: user.email, confirmationUrl: url, token: data.token }
  const EmailTemplate = action === 'signup'
    ? SignupEmail
    : action === 'invite'
      ? InviteEmail
      : action === 'recovery'
        ? RecoveryEmail
        : MagicLinkEmail

  return [{
    recipient: user.email,
    subject: SUBJECTS[action],
    label: action,
    element: React.createElement(EmailTemplate, templateProps),
  }]
}
