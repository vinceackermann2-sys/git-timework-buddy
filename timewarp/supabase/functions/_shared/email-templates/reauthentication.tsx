import * as React from 'npm:react@18.3.1'
import { EmailCode, EmailNotice, EmailShell, EmailText } from './brand.tsx'

interface ReauthenticationEmailProps {
  siteName: string
  siteUrl: string
  token: string
}

export const ReauthenticationEmail = ({ siteName, siteUrl, token }: ReauthenticationEmailProps) => (
  <EmailShell
    preview={`Your ${siteName} verification code: ${token}`}
    eyebrow="Sensitive action"
    heading="Confirm it’s you"
    siteUrl={siteUrl}
  >
    <EmailText>
      Enter this one-time code in Timewarp to confirm your identity and continue with the account change.
    </EmailText>
    <EmailCode>{token}</EmailCode>
    <EmailNotice>
      The code expires shortly and can only be used for this request. Timewarp support will never ask you to share it.
    </EmailNotice>
  </EmailShell>
)

export default ReauthenticationEmail
