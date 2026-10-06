import * as React from 'npm:react@18.3.1'
import { Section, Text } from 'npm:@react-email/components@0.0.22'
import { EmailNotice, EmailShell, EmailText, emailBrand } from './brand.tsx'

interface ContactSubmissionEmailProps {
  siteUrl: string
  label: string
  heading: string
  details: Array<[string, string]>
  issueDetails: Array<[string, string]>
  message: string
}

export const ContactSubmissionEmail = ({
  siteUrl,
  label,
  heading,
  details,
  issueDetails,
  message,
}: ContactSubmissionEmailProps) => (
  <EmailShell preview={`${label}: ${heading}`} eyebrow={label} heading={heading} siteUrl={siteUrl}>
    <Section style={detailsBox}>
      {details.map(([key, value]) => (
        <Text key={key} style={detailRow}><strong>{key}:</strong> {value}</Text>
      ))}
    </Section>
    {issueDetails.map(([key, value]) => (
      <Section key={key} style={messageBox}>
        <Text style={sectionLabel}>{key}</Text>
        <Text style={messageText}>{value}</Text>
      </Section>
    ))}
    <Section style={messageBox}>
      <Text style={sectionLabel}>Message</Text>
      <Text style={messageText}>{message}</Text>
    </Section>
  </EmailShell>
)

interface ContactReceiptEmailProps {
  siteUrl: string
  name: string
  kind: 'general' | 'enterprise' | 'issue'
}

export const ContactReceiptEmail = ({ siteUrl, name, kind }: ContactReceiptEmailProps) => {
  const description = kind === 'issue'
    ? 'Your report is in our review queue. The details you included will help us investigate it.'
    : kind === 'enterprise'
      ? 'Our team received your enterprise enquiry and will follow up at this email address.'
      : 'Our team received your message and will follow up at this email address.'
  return (
    <EmailShell preview="We received your message" eyebrow="Message received" heading={`Thanks, ${name}`} siteUrl={siteUrl}>
      <EmailText>{description}</EmailText>
      <EmailNotice>You can reply directly to this email if you need to add anything.</EmailNotice>
    </EmailShell>
  )
}

export const WaitlistConfirmationEmail = ({ siteUrl }: { siteUrl: string }) => (
  <EmailShell preview="You're on the Timewarp for Mac waitlist" eyebrow="Mac waitlist" heading="You're on the list" siteUrl={siteUrl}>
    <EmailText>We saved your place for Timewarp on Mac. We'll email you when the Mac release is ready.</EmailText>
    <EmailNotice>No further action is needed.</EmailNotice>
  </EmailShell>
)

const detailsBox = {
  backgroundColor: emailBrand.gray,
  border: `1px solid ${emailBrand.border}`,
  borderRadius: '8px',
  margin: '0 0 20px',
  padding: '12px 16px',
}
const detailRow = { color: emailBrand.muted, fontSize: '13px', lineHeight: '1.5', margin: '4px 0' }
const messageBox = { margin: '18px 0 0' }
const sectionLabel = { color: emailBrand.link, fontSize: '11px', fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase' as const }
const messageText = { color: emailBrand.muted, fontSize: '14px', lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap' as const }
