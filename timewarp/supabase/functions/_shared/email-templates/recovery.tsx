import * as React from 'npm:react@18.3.1'
import { EmailButton, EmailLinkFallback, EmailNotice, EmailShell, EmailText } from './brand.tsx'

interface RecoveryEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, siteUrl, confirmationUrl }: RecoveryEmailProps) => (
  <EmailShell
    preview={`Reset your ${siteName} password`}
    eyebrow="Account recovery"
    heading="Reset your password"
    siteUrl={siteUrl}
  >
    <EmailText>
      We received a request to reset your Timewarp password. Open the secure reset page to choose a new one.
    </EmailText>
    <EmailButton href={confirmationUrl}>Choose a new password</EmailButton>
    <EmailNotice>
      If you didn’t request a reset, no action is needed and your password remains unchanged. For extra safety, the link expires automatically.
    </EmailNotice>
    <EmailLinkFallback href={confirmationUrl} />
  </EmailShell>
)

export default RecoveryEmail
