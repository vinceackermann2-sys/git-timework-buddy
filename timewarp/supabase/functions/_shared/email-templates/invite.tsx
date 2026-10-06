import * as React from 'npm:react@18.3.1'
import { EmailButton, EmailLinkFallback, EmailNotice, EmailShell, EmailText } from './brand.tsx'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <EmailShell
    preview={`You’ve been invited to ${siteName}`}
    eyebrow="Your invitation"
    heading="Welcome to Timewarp"
    siteUrl={siteUrl}
  >
    <EmailText>
      An account has been reserved for this email address. Accept the invitation to finish setting up your Timewarp access.
    </EmailText>
    <EmailButton href={confirmationUrl}>Accept invitation</EmailButton>
    <EmailNotice>
      This invitation is tied to your email address. If you weren’t expecting it, you can safely ignore this message.
    </EmailNotice>
    <EmailLinkFallback href={confirmationUrl} />
  </EmailShell>
)

export default InviteEmail
