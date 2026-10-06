import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface EmailShellProps {
  preview: string
  eyebrow: string
  heading: string
  siteUrl: string
  children?: any
}

// Fixed email colors match the desktop's default Ice blue accent. Inline styles
// and table layouts also work in clients that ignore stylesheets and web fonts.
export const emailBrand = {
  white: '#FFFFFF',
  black: '#182230',
  background: '#F4F7FB',
  gray: '#F4F7FB',
  muted: '#526175',
  border: '#DCE4EE',
  accent: '#B7D6FF',
  link: '#315A8A',
  accentSoft: '#EAF2FF',
  accentBorder: '#C9DDF7',
  accentText: '#315A8A',
} as const

export const emailLogoUrl = Deno.env.get('TIMEWARP_EMAIL_LOGO_URL') ||
  'https://mrqoeywofslgnquvzhuf.supabase.co/storage/v1/object/public/timewarp-brand-assets/timewarp-email-logo.png'

export const EmailShell = ({ preview, eyebrow, heading, siteUrl, children }: EmailShellProps) => {
  const baseUrl = siteUrl.replace(/\/+$/, '')

  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <style>{`@media only screen and (max-width: 480px) {
          .timewarp-email-page { padding: 24px 12px 32px !important; }
          .timewarp-email-card { padding: 24px 20px !important; }
          .timewarp-email-code { font-size: 26px !important; letter-spacing: 3px !important; }
        }`}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container className="timewarp-email-page" style={page}>
          <Section style={brandHeader}>
            <Link href={baseUrl} style={brandLink}>
              <Img src={emailLogoUrl} width="48" height="48" alt="Timewarp" style={brandMark} />
              <span style={brandName}>Timewarp</span>
            </Link>
          </Section>

          <Section className="timewarp-email-card" style={card}>
            <Text style={eyebrowStyle}>{eyebrow}</Text>
            <Heading style={headingStyle}>{heading}</Heading>
            {children}
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              Need help?{' '}
              <Link href="mailto:support@timewarpdev.com" style={footerLink}>
                support@timewarpdev.com
              </Link>
            </Text>
            <Text style={footerText}>
              <Link href={`${baseUrl}/legal/privacy-policy`} style={footerLink}>Privacy</Link>
              <span style={footerDot}> • </span>
              <Link href={`${baseUrl}/legal/terms-of-service`} style={footerLink}>Terms</Link>
              <span style={footerDot}> • </span>
              <Link href={baseUrl} style={footerLink}>timewarpdev.com</Link>
            </Text>
            <Text style={address}>Timewarp</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const EmailText = ({ children }: { children?: any }) => (
  <Text style={textStyle}>{children}</Text>
)

export const EmailButton = ({ href, children }: { href: string; children?: any }) => (
  <Section style={buttonRow}>
    <Button style={buttonStyle} href={href}>{children}</Button>
  </Section>
)

export const EmailLinkFallback = ({ href }: { href: string }) => (
  <Section style={fallbackBox}>
    <Text style={fallbackLabel}>Button not working? Copy this secure link:</Text>
    <Link href={href} style={fallbackLink}>{href}</Link>
  </Section>
)

export const EmailNotice = ({ children }: { children?: any }) => (
  <Section style={noticeBox}>
    <Text style={noticeText}>{children}</Text>
  </Section>
)

export const EmailCode = ({ children }: { children?: any }) => (
  <Section style={codeBox}>
    <Text className="timewarp-email-code" style={codeStyle}>{children}</Text>
  </Section>
)

export const EmailDivider = () => <Hr style={divider} />

export const emailLinkStyle = {
  color: emailBrand.link,
  fontWeight: 700,
  textDecoration: 'underline',
}

const main = {
  backgroundColor: emailBrand.background,
  color: emailBrand.black,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  margin: 0,
  padding: 0,
}

const page = {
  margin: '0 auto',
  maxWidth: '600px',
  padding: '40px 20px 44px',
}

const brandHeader = { padding: '0 0 20px' }

const brandLink = {
  color: emailBrand.black,
  display: 'inline-block',
  textDecoration: 'none',
}

const brandMark = {
  display: 'inline-block',
  height: '48px',
  marginRight: '12px',
  verticalAlign: 'middle',
  width: '48px',
}

const brandName = {
  color: emailBrand.black,
  fontSize: '20px',
  fontWeight: 700,
  letterSpacing: '-0.2px',
  verticalAlign: 'middle',
}

const card = {
  backgroundColor: emailBrand.white,
  border: `1px solid ${emailBrand.border}`,
  borderRadius: '16px',
  borderTop: `4px solid ${emailBrand.accent}`,
  padding: '36px 36px 32px',
}

const eyebrowStyle = {
  color: emailBrand.link,
  fontSize: '11px',
  fontWeight: 800,
  letterSpacing: '1.3px',
  margin: '0 0 12px',
  textTransform: 'uppercase' as const,
}

const headingStyle = {
  color: emailBrand.black,
  fontSize: '29px',
  fontWeight: 700,
  letterSpacing: '-0.6px',
  lineHeight: '1.18',
  margin: '0 0 22px',
}

const textStyle = {
  color: emailBrand.muted,
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0 0 18px',
}

const buttonRow = { margin: '27px 0 24px' }

const buttonStyle = {
  backgroundColor: emailBrand.accent,
  borderRadius: '8px',
  color: emailBrand.black,
  fontSize: '14px',
  fontWeight: 700,
  padding: '14px 23px',
  textDecoration: 'none',
}

const fallbackBox = {
  backgroundColor: emailBrand.gray,
  border: `1px solid ${emailBrand.border}`,
  borderRadius: '8px',
  margin: '24px 0 0',
  padding: '14px 16px',
}

const fallbackLabel = {
  color: emailBrand.muted,
  fontSize: '11px',
  fontWeight: 700,
  margin: '0 0 6px',
}

const fallbackLink = {
  color: emailBrand.link,
  display: 'block',
  fontSize: '11px',
  lineHeight: '1.45',
  overflowWrap: 'anywhere' as const,
  wordBreak: 'break-all' as const,
}

const noticeBox = {
  backgroundColor: emailBrand.accentSoft,
  border: `1px solid ${emailBrand.accentBorder}`,
  borderRadius: '8px',
  margin: '22px 0 0',
  padding: '13px 15px',
}

const noticeText = {
  color: emailBrand.accentText,
  fontSize: '12px',
  lineHeight: '1.55',
  margin: 0,
}

const codeBox = {
  backgroundColor: emailBrand.accentSoft,
  border: `1px solid ${emailBrand.accentBorder}`,
  borderRadius: '8px',
  margin: '24px 0',
  padding: '20px',
  textAlign: 'center' as const,
}

const codeStyle = {
  color: emailBrand.black,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '30px',
  fontWeight: 800,
  letterSpacing: '4px',
  margin: 0,
}

const divider = { borderColor: emailBrand.border, margin: '25px 0' }

const footer = { padding: '21px 10px 0', textAlign: 'center' as const }

const footerText = {
  color: emailBrand.muted,
  fontSize: '11px',
  lineHeight: '1.55',
  margin: '0 0 5px',
}

const footerLink = { color: '#4A4A4A', textDecoration: 'underline' }
const footerDot = { color: '#BDBDBD' }
const address = { color: '#8A8A8A', fontSize: '10px', margin: '10px 0 0' }
