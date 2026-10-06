import * as React from 'npm:react@18.3.1'
import { Link } from 'npm:@react-email/components@0.0.22'
import {
  EmailButton,
  EmailCode,
  EmailLinkFallback,
  EmailNotice,
  EmailShell,
  EmailText,
  emailLinkStyle,
} from './brand.tsx'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
  token?: string
}

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl, token }: SignupEmailProps) => (
  <EmailShell
    preview={`Confirm your email and start using ${siteName}`}
    eyebrow="Welcome to Timewarp"
    heading="Confirm your email"
    siteUrl={siteUrl}
  >
    <EmailText>
      You’re one step away from your Timewarp workspace. Confirm{' '}
      <Link href={`mailto:${recipient}`} style={emailLinkStyle}>{recipient}</Link>{' '}
      to finish creating your account.
    </EmailText>
    <EmailText>
      Once confirmed, you can sign in across the Timewarp desktop app and website with the same account.
    </EmailText>
    <EmailButton href={confirmationUrl}>Confirm email</EmailButton>
    {token && <>
      <EmailText>Or enter this one-time code in the app to confirm your email:</EmailText>
      <EmailCode>{token}</EmailCode>
    </>}
    <EmailNotice>
      This link is personal to you and expires automatically. If you didn’t create a Timewarp account, you can ignore this email.
    </EmailNotice>
    <EmailLinkFallback href={confirmationUrl} />
  </EmailShell>
)

export default SignupEmail
