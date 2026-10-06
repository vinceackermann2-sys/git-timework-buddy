# Branded authentication and Lovable hosting

The root website application serves the existing `timewarp-site/dist/index.html`
and assets. The desktop source remains in `timewarp/`. Both histories are retained
in `vinceackermann2-sys/git-timework-buddy`; published history is not rewritten.

Google uses `https://timewarpdev.com/auth/google` and the registered callback
`https://timewarpdev.com/auth/v1/callback`. `/auth/bridge` is a compatible start
route. The browser consumes its state once, removes the identity assertion from
history, and encrypts the handoff to the initiating desktop. The desktop performs
the final provider-token verification and session exchange. The website requires
no private Google client secret or Supabase service key.

Email-code verification preserves a pending link after an incorrect code, accepts
copied code grouping, and does not discard a newer sign-in attempt. Signup and
email sign-in resend their respective code types with a cooldown.

Lovable project `cbb636a5-6463-4d72-8642-2660fb02af3e` is connected to the existing
TimeWarp Production backend, `mrqoeywofslgnquvzhuf`. Backend secrets remain in that
project's vault. Private credentials are not duplicated into Git or public browser
variables. The Resend, email-hook, branded sender, billing, webhook, and Azure
credential names required by the existing functions are present.

Production inspection on October 6 verified that the deployed `timewarp-energy`,
`stripe-billing`, `stripe-webhook`, and their six shared modules match local source.
The deployed email hook, contact, workspace functions, and email templates also
match. No function-source update is needed for these client and hosting changes.

The checkout and AI settlement recovery migrations are already recorded as
`20261005220000` and `20261006100000`. The accounting RPCs, atomic preference
merge, and minute-by-minute AI recovery Cron job are present. Earlier October 4
migrations were applied with these production version names:

| Local source version | Production version |
| --- | --- |
| 20261004134734 | 20261004135810 |
| 20261004162836 | 20261004163234 |
| 20261004164232 | 20261004164335 |
| 20261004194133 | 20261004194404 |
| 20261004202217 | 20261004202850 |

Do not blindly reapply these migrations based on the timestamp difference. The
accounting migration's RPC definitions were also checked directly in production.
No database schema change is needed for the authentication fixes.

Validation: 136 desktop tests, 18 email-template tests, website routing and Google
handoff tests, syntax/type checks, website production build, packaged desktop
contracts, and a service-issued signup code in an isolated packaged desktop
profile. Browser handoff checks use a fixture assertion; completing Google account
approval still requires the account owner. Inbox delivery was not tested by sending
mail to other people. Public installer URLs remain unset in the existing website.
