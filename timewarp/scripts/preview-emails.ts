import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createMessages, type HookPayload } from '../supabase/functions/auth-email-hook/messages.ts'
import { WorkspaceInviteEmail } from '../supabase/functions/_shared/email-templates/workspace-invite.tsx'
import { ContactReceiptEmail, ContactSubmissionEmail, WaitlistConfirmationEmail } from '../supabase/functions/_shared/email-templates/contact.tsx'

Deno.env.set('SUPABASE_URL', 'https://mrqoeywofslgnquvzhuf.supabase.co')
const directory = 'reports/email-previews'
await Deno.mkdir(directory, { recursive: true })
const actions: HookPayload['email_data']['email_action_type'][] = [
  'signup', 'invite', 'magiclink', 'email', 'recovery', 'email_change', 'reauthentication',
  'password_changed_notification', 'email_changed_notification', 'phone_changed_notification',
  'identity_linked_notification', 'identity_unlinked_notification',
  'mfa_factor_enrolled_notification', 'mfa_factor_unenrolled_notification',
]
const previews: Array<{ filename: string; title: string; element: React.ReactElement }> = []
for (const action of actions) {
  const messages = createMessages({
    user: { id: 'preview', email: 'alex@example.test', new_email: 'alex.new@example.test', phone: '+46000000000' },
    email_data: { email_action_type: action, token: '0123456789', token_hash: 'preview-only-not-a-real-token', token_hash_new: 'preview-current-not-a-real-token', redirect_to: 'http://127.0.0.1:17654/oauth-callback', old_email: 'alex.old@example.test', old_phone: '+46000000001', provider: 'Google', factor_type: 'Authenticator' },
  })
  for (const message of messages) previews.push({ filename: message.label, title: message.subject, element: message.element })
}
const siteUrl = 'https://timewarpdev.com'
previews.push({ filename: 'workspace-invite', title: 'Workspace invitation', element: React.createElement(WorkspaceInviteEmail, { siteUrl, inviteUrl: siteUrl + '/invite?token=preview-only', workspaceName: 'Design studio', inviterName: 'Morgan', inviterEmail: 'morgan@example.test', roleLabel: 'Member' }) })
for (const kind of ['general', 'enterprise', 'issue'] as const) previews.push({ filename: 'contact-' + kind, title: 'Contact confirmation: ' + kind, element: React.createElement(ContactReceiptEmail, { siteUrl, name: 'Alex', kind }) })
previews.push({ filename: 'contact-submission', title: 'Support submission', element: React.createElement(ContactSubmissionEmail, { siteUrl, label: 'Timewarp support', heading: 'Sign-in help', details: [['Name', 'Alex'], ['Email', 'alex@example.test']], issueDetails: [], message: 'Please help me sign in on my new computer.' }) })
previews.push({ filename: 'waitlist', title: 'Mac waitlist confirmation', element: React.createElement(WaitlistConfirmationEmail, { siteUrl }) })
for (const preview of previews) {
  await Deno.writeTextFile(`${directory}/${preview.filename}.html`, await renderAsync(preview.element))
  await Deno.writeTextFile(`${directory}/${preview.filename}.txt`, await renderAsync(preview.element, { plainText: true }))
}
const options = previews.map(p => `<option value="${p.filename}">${p.title}</option>`).join('')
await Deno.writeTextFile(`${directory}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Timewarp email previews</title>
<style>body{margin:0;background:#F4F7FB;color:#182230;font:15px system-ui}header{padding:24px;border-bottom:1px solid #DCE4EE;background:white}h1{margin:0 0 8px;font-size:24px}p{color:#526175}select{font:inherit;padding:10px;border:1px solid #DCE4EE;border-radius:8px;max-width:100%}main{display:flex;gap:24px;padding:24px;flex-wrap:wrap}iframe{height:1120px;border:1px solid #DCE4EE;border-radius:16px;background:white;max-width:100%}section{max-width:100%}a{color:#315A8A}</style>
<header><h1>Timewarp emails</h1><p>App logo, Ice blue accent, secure links and one-time codes. These previews use sample details.</p><select id="template" aria-label="Email template">${options}</select> <a id="plain" href="signup.txt">Plain text</a></header>
<main><section><h2>Desktop</h2><iframe title="Desktop email preview" width="600" src="signup.html"></iframe></section><section><h2>Mobile · 320px</h2><iframe title="Mobile email preview" width="320" src="signup.html"></iframe></section></main>
<script>document.getElementById('template').addEventListener('change',e=>{document.querySelectorAll('iframe').forEach(frame=>frame.src=e.target.value+'.html');document.getElementById('plain').href=e.target.value+'.txt'})</script></html>`)
console.log(`Rendered ${previews.length} email previews with HTML and plain-text versions.`)
