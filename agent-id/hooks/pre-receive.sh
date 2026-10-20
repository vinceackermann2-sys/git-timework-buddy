#!/usr/bin/env bash
# Timewarp Agent ID pre-receive hook for self-hosted Git servers (Gitea,
# GitLab, Gerrit, plain SSH). It rejects a push unless every new commit,
# merge commits included, carries a valid SSH signature by a key that is
# either an active, allowed agent of your organization (as Agent ID lists it
# right now) or a human signer you listed. Author and committer emails prove
# nothing, so unsigned commits are always rejected. If Agent ID can't be
# asked, the push is rejected (fail closed).
#
# Install: copy to <repo>.git/hooks/pre-receive (or your server's global
# hooks folder) and make it executable. Needs bash, git 2.34+, curl and
# OpenSSH's ssh-keygen.
#
# Settings (environment variables, or git config in the server repository):
#   AGENT_ID_SECRET              / agentid.secret            company secret, twrp_… (required)
#   AGENT_ID_SECRET_FILE         / agentid.secretFile        or a file holding it
#   AGENT_ID_API                 / agentid.api               default: production
#   AGENT_ID_HUMAN_SIGNERS_FILE  / agentid.humanSignersFile  a file on the server, in Git
#        allowed_signers format, for people who sign their own commits with SSH keys:
#        alice@acme.com namespaces="git" ssh-ed25519 AAAA…
#        Keep it where only server admins can write it (not in a pushed repository).
set -u

conf() { git config --get "$1" 2>/dev/null || true; }

secret=${AGENT_ID_SECRET:-$(conf agentid.secret)}
secret_file=${AGENT_ID_SECRET_FILE:-$(conf agentid.secretFile)}
if [ -z "$secret" ] && [ -n "$secret_file" ] && [ -r "$secret_file" ]; then
  secret=$(tr -d ' \r\n' < "$secret_file")
fi
api=${AGENT_ID_API:-$(conf agentid.api)}
api=${api:-https://mrqoeywofslgnquvzhuf.supabase.co/functions/v1/agent-id}
api=${api%/}
humans=${AGENT_ID_HUMAN_SIGNERS_FILE:-$(conf agentid.humanSignersFile)}

if [ -n "${AGENT_ID_ALLOW_UNSIGNED_AUTHORS:-}$(conf agentid.allowUnsignedAuthors)" ]; then
  echo "Agent ID: warning: allowUnsignedAuthors was removed (an author email proves nothing); list humans' SSH keys in AGENT_ID_HUMAN_SIGNERS_FILE instead." >&2
fi

if [ -z "$secret" ]; then
  echo "Agent ID: no company secret is configured (AGENT_ID_SECRET or git config agentid.secret); rejecting the push." >&2
  exit 1
fi
if [ -n "$humans" ] && [ ! -r "$humans" ]; then
  echo "Agent ID: the human signers file $humans can't be read; rejecting the push." >&2
  exit 1
fi

work=$(mktemp -d 2>/dev/null || mktemp -d -t agentid)
trap 'rm -rf "$work"' EXIT
signers="$work/allowed_signers"

# The secret goes to curl on stdin, not on its command line.
if ! printf 'Authorization: Bearer %s\n' "$secret" | curl -fsS --max-time 30 -H @- -H 'Accept: text/plain' -o "$signers" "$api/v1/allowed-signers"; then
  echo "Agent ID: could not get the allowed signers from $api; rejecting the push." >&2
  exit 1
fi
if [ -n "$humans" ]; then
  printf '\n' >> "$signers"
  tr -d '\r' < "$humans" >> "$signers"
  printf '\n' >> "$signers"
fi

failed=0
while read -r old new ref; do
  # A deleted ref brings no commits.
  case "$new" in *[!0]*) ;; *) continue ;; esac
  case "$old" in
    *[!0]*) commits=$(git rev-list "$old..$new") ;;
    *) commits=$(git rev-list "$new" --not --all) ;;   # A new ref: what no ref has yet.
  esac
  for sha in $commits; do
    if output=$(git -c gpg.ssh.allowedSignersFile="$signers" -c gpg.minTrustLevel=fully verify-commit "$sha" 2>&1) \
      && printf '%s' "$output" | grep -q 'Good "git" signature for'; then
      continue
    fi
    author=$(git log -1 --format=%ae "$sha")
    subject=$(git log -1 --format=%s "$sha" | cut -c1-72)
    if ! git cat-file commit "$sha" | sed '/^$/q' | grep -q '^gpgsig'; then
      reason="not signed"
    elif ! git cat-file commit "$sha" | sed '/^$/q' | grep -q 'BEGIN SSH SIGNATURE'; then
      reason="signed with GPG or X.509, not an SSH key"
    elif printf '%s' "$output" | grep -q 'No principal matched'; then
      reason="signed with a key that is neither a current agent of this organization nor a listed human signer"
    else
      reason="signature not valid"
    fi
    echo "Agent ID: $ref: $(printf '%s' "$sha" | cut -c1-12) \"$subject\" (author $author, unverified): $reason" >&2
    failed=1
  done
done

if [ "$failed" -ne 0 ]; then
  echo "Agent ID: push rejected. Only commits signed by your organization's current agents (see \`timewarp-id git setup\`) or by listed human signers are accepted here." >&2
  exit 1
fi
exit 0
