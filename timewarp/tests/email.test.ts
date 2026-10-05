import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createMessages, type HookPayload } from '../supabase/functions/auth-email-hook/messages.ts'
import { WorkspaceInviteEmail } from '../supabase/functions/_shared/email-templates/workspace-invite.tsx'
import { ContactReceiptEmail, ContactSubmissionEmail, WaitlistConfirmationEmail } from '../supabase/functions/_shared/email-templates/contact.tsx'

Deno.env.set('SUPABASE_URL', 'https://mrqoeywofslgnquvzhuf.supabase.co')
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const payload = (action: HookPayload['email_data']['email_action_type']): HookPayload => ({
  user: { id: 'email-fixture', email: 'person@example.test', new_email: 'new@example.test', phone: '+46000000000' },
  email_data: {
    email_action_type: action,
    token: '0123456789',
    token_hash: 'new-address-hash',
    token_new: '9876543210',
    token_hash_new: 'current-address-hash',
    redirect_to: 'http://127.0.0.1:17654/oauth-callback',
    old_email: 'old@example.test', old_phone: '+46000000001', provider: 'Google', factor_type: 'TOTP',
  },
})

const actions: HookPayload['email_data']['email_action_type'][] = [
  'signup', 'invite', 'magiclink', 'email', 'recovery', 'email_change', 'reauthentication',
  'password_changed_notification', 'email_changed_notification', 'phone_changed_notification',
  'identity_linked_notification', 'identity_unlinked_notification',
  'mfa_factor_enrolled_notification', 'mfa_factor_unenrolled_notification',
]

for (const action of actions) {
  Deno.test(`${action}: branded HTML and text preserve tokens and desktop callback`, async () => {
    for (const message of createMessages(payload(action))) {
      const html = await renderAsync(message.element)
      const text = await renderAsync(message.element, { plainText: true })
      assert(html.includes('alt="Timewarp"'), 'Logo must have a readable brand fallback')
      assert(html.includes('timewarp-brand-assets/timewarp-email-logo.png'), 'Use the app logo')
      assert(html.includes('#B7D6FF'), 'Use the app accent')
      assert(html.includes('max-width: 480px'), 'Include the mobile layout')
      assert(html.includes('support@timewarpdev.com') && text.includes('support@timewarpdev.com'), 'Support appears in both formats')
      assert(text.includes('Timewarp') && message.subject.includes('Timewarp'), 'Brand the text and subject')
      assert(!html.includes('TimeWarp') && !html.includes('#A562BC'), 'Retired branding must be absent')
      if (['signup', 'magiclink', 'email', 'reauthentication'].includes(action)) {
        assert(html.includes('0123456789') && text.includes('0123456789'), 'Preserve leading zeroes and ten-digit codes')
      }
      if (['signup', 'invite', 'magiclink', 'email', 'recovery', 'email_change'].includes(action)) {
        const link = message.element.props.confirmationUrl
        const url = new URL(link)
        assert(url.origin === 'https://mrqoeywofslgnquvzhuf.supabase.co', 'Verify on the authentication service')
        assert(url.searchParams.get('redirect_to') === 'http://127.0.0.1:17654/oauth-callback', 'Preserve the desktop return URL')
        assert(url.searchParams.get('type') === action, 'Preserve the authentication action')
        assert(html.includes(link.replaceAll('&', '&amp;')) && text.includes(link), 'Keep the usable link in both formats')
      }
    }
  })
}

Deno.test('secure email changes send the correct hash to each address', () => {
  const messages = createMessages(payload('email_change'))
  assert(messages.length === 2, 'Confirm both addresses')
  assert(messages[0].recipient === 'person@example.test' && messages[0].suffix === 'current', 'First message belongs to the current address')
  assert(new URL(messages[0].element.props.confirmationUrl).searchParams.get('token') === 'current-address-hash', 'Current address gets token_hash_new')
  assert(messages[1].recipient === 'new@example.test' && messages[1].suffix === 'new', 'Second message belongs to the new address')
  assert(new URL(messages[1].element.props.confirmationUrl).searchParams.get('token') === 'new-address-hash', 'New address gets token_hash')
})

Deno.test('missing optional codes do not create an empty code panel', async () => {
  for (const action of ['signup', 'magiclink'] as const) {
    const input = payload(action)
    delete input.email_data.token
    const html = await renderAsync(createMessages(input)[0].element)
    assert(!html.includes('class="timewarp-email-code"'), 'Omit absent codes')
    assert(!html.includes('undefined'), 'Never render missing data')
  }
})

Deno.test('recovery instructions use the password-reset link accepted by the app', async () => {
  const message = createMessages(payload('recovery'))[0]
  const html = await renderAsync(message.element)
  const text = await renderAsync(message.element, { plainText: true })
  assert(!html.includes('class="timewarp-email-code"'), 'The reset screen has no recovery-code input')
  assert(text.includes('Choose a new password') && text.includes(message.element.props.confirmationUrl), 'Provide the secure password-reset link')
})

Deno.test('workspace, contact and waitlist emails share the brand and escape user content', async () => {
  const siteUrl = 'https://timewarpdev.com'
  const hostile = '<script>alert("test")</script>'
  const elements = [
    React.createElement(WorkspaceInviteEmail, { siteUrl, inviteUrl: siteUrl + '/invite?token=fixture', workspaceName: hostile, inviterName: 'Morgan', inviterEmail: 'morgan@example.test', roleLabel: 'Member' }),
    React.createElement(ContactReceiptEmail, { siteUrl, name: hostile, kind: 'general' }),
    React.createElement(ContactReceiptEmail, { siteUrl, name: 'Morgan', kind: 'enterprise' }),
    React.createElement(ContactReceiptEmail, { siteUrl, name: 'Morgan', kind: 'issue' }),
    React.createElement(ContactSubmissionEmail, { siteUrl, label: 'Timewarp message', heading: 'Contact', details: [['Name', hostile]], issueDetails: [], message: hostile }),
    React.createElement(WaitlistConfirmationEmail, { siteUrl }),
  ]
  for (const element of elements) {
    const html = await renderAsync(element)
    const text = await renderAsync(element, { plainText: true })
    assert(html.includes('alt="Timewarp"') && html.includes('#B7D6FF'), 'Use the shared branding')
    assert(text.includes('Timewarp') && text.includes('support@timewarpdev.com'), 'Keep the text fallback branded')
    assert(!html.includes('<script>'), 'Escape user-controlled content')
  }
})
