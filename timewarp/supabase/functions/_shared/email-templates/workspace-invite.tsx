import * as React from 'npm:react@18.3.1'
import { EmailButton, EmailDivider, EmailLinkFallback, EmailNotice, EmailShell, EmailText } from './brand.tsx'

interface WorkspaceInviteEmailProps {
  siteUrl: string
  inviteUrl: string
  workspaceName: string
  inviterName: string
  inviterEmail: string
  roleLabel: string
}

export const WorkspaceInviteEmail = ({
  siteUrl,
  inviteUrl,
  workspaceName,
  inviterName,
  inviterEmail,
  roleLabel,
}: WorkspaceInviteEmailProps) => (
  <EmailShell
    preview={`${inviterName} invited you to ${workspaceName} in Timewarp`}
    eyebrow="Workspace invitation"
    heading={`Join ${workspaceName}`}
    siteUrl={siteUrl}
  >
    <EmailText>
      {inviterName} ({inviterEmail}) invited you to collaborate in the <strong>{workspaceName}</strong> workspace on Timewarp.
    </EmailText>
    <EmailDivider />
    <EmailText>
      Your role will be <strong>{roleLabel}</strong>. The invitation works whether you already have a Timewarp account or need to create one.
    </EmailText>
    <EmailButton href={inviteUrl}>Review and accept</EmailButton>
    <EmailNotice>
      This invitation is only valid for the email address it was sent to and expires in 14 days. Don’t forward this email.
    </EmailNotice>
    <EmailLinkFallback href={inviteUrl} />
  </EmailShell>
)

export default WorkspaceInviteEmail
