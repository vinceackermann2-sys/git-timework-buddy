import * as React from 'npm:react@18.3.1'
import { Link } from 'npm:@react-email/components@0.0.22'
import {
  EmailButton,
  EmailLinkFallback,
  EmailNotice,
  EmailShell,
  EmailText,
  emailLinkStyle,
} from './brand.tsx'

interface EmailChangeEmailProps {
  siteName: string
  siteUrl: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({ siteName, siteUrl, oldEmail, newEmail, confirmationUrl }: EmailChangeEmailProps) => (
  <EmailShell
    preview={`Confirm your ${siteName} email change`}
    eyebrow="Account security"
    heading="Confirm your new email"
    siteUrl={siteUrl}
  >
    <EmailText>
      You asked to change your Timewarp sign-in from{' '}
      <Link href={`mailto:${oldEmail}`} style={emailLinkStyle}>{oldEmail}</Link>{' '}
      to <Link href={`mailto:${newEmail}`} style={emailLinkStyle}>{newEmail}</Link>.
    </EmailText>
    <EmailText>Confirm this address to complete the secure email-change process.</EmailText>
    <EmailButton href={confirmationUrl}>Confirm email change</EmailButton>
    <EmailNotice>
      Didn’t make this request? Don’t use the link. Sign in to Timewarp, secure your account, and contact support immediately.
    </EmailNotice>
    <EmailLinkFallback href={confirmationUrl} />
  </EmailShell>
)

export default EmailChangeEmail
