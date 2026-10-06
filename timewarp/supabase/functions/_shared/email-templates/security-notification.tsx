import * as React from 'npm:react@18.3.1'
import { EmailNotice, EmailShell, EmailText } from './brand.tsx'

export type SecurityNotificationType =
  | 'password_changed_notification'
  | 'email_changed_notification'
  | 'phone_changed_notification'
  | 'identity_linked_notification'
  | 'identity_unlinked_notification'
  | 'mfa_factor_enrolled_notification'
  | 'mfa_factor_unenrolled_notification'

interface SecurityNotificationEmailProps {
  siteUrl: string
  actionType: SecurityNotificationType
  email?: string
  oldEmail?: string
  phone?: string
  oldPhone?: string
  provider?: string
  factorType?: string
}

const copyFor = (props: SecurityNotificationEmailProps) => {
  switch (props.actionType) {
    case 'password_changed_notification':
      return ['Password changed', 'Your Timewarp password was changed successfully.']
    case 'email_changed_notification':
      return [
        'Email address changed',
        `Your Timewarp sign-in email was changed${props.oldEmail && props.email ? ` from ${props.oldEmail} to ${props.email}` : ''}.`,
      ]
    case 'phone_changed_notification':
      return [
        'Phone number changed',
        `The phone number on your Timewarp account was changed${props.oldPhone && props.phone ? ` from ${props.oldPhone} to ${props.phone}` : ''}.`,
      ]
    case 'identity_linked_notification':
      return ['Sign-in method added', `${props.provider || 'A new provider'} was linked to your Timewarp account.`]
    case 'identity_unlinked_notification':
      return ['Sign-in method removed', `${props.provider || 'A provider'} was removed from your Timewarp account.`]
    case 'mfa_factor_enrolled_notification':
      return ['Verification method added', `${props.factorType || 'A new verification method'} was added to your Timewarp account.`]
    case 'mfa_factor_unenrolled_notification':
      return ['Verification method removed', `${props.factorType || 'A verification method'} was removed from your Timewarp account.`]
  }
}

export const SecurityNotificationEmail = (props: SecurityNotificationEmailProps) => {
  const [heading, detail] = copyFor(props)
  return (
    <EmailShell
      preview={`${heading} on your Timewarp account`}
      eyebrow="Account security"
      heading={heading}
      siteUrl={props.siteUrl}
    >
      <EmailText>{detail}</EmailText>
      <EmailNotice>
        If this was you, no action is needed. If you did not make this change, secure your account and contact support immediately.
      </EmailNotice>
    </EmailShell>
  )
}

export default SecurityNotificationEmail
