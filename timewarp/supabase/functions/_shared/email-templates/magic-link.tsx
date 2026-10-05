import * as React from 'npm:react@18.3.1'
import { EmailButton, EmailCode, EmailLinkFallback, EmailNotice, EmailShell, EmailText } from './brand.tsx'

interface MagicLinkEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
  token?: string
}

export const MagicLinkEmail = ({ siteName, siteUrl, confirmationUrl, token }: MagicLinkEmailProps) => (
  <EmailShell
    preview={`Your secure sign-in link for ${siteName}`}
    eyebrow="Secure sign in"
    heading="Sign in to Timewarp"
    siteUrl={siteUrl}
  >
    <EmailText>
      Use the secure button below to sign in. It works once, expires shortly, and returns you to the page where you started.
    </EmailText>
    <EmailButton href={confirmationUrl}>Sign in to Timewarp</EmailButton>
    {token && <>
      <EmailText>Or enter this one-time code in the app to sign in:</EmailText>
      <EmailCode>{token}</EmailCode>
    </>}
    <EmailNotice>
      The link and code work once and expire automatically. Didn’t request this email? You can safely ignore it. Never share your sign-in link or code.
    </EmailNotice>
    <EmailLinkFallback href={confirmationUrl} />
  </EmailShell>
)

export default MagicLinkEmail
