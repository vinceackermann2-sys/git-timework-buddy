# Agent ID commit check (GitHub Action)

Lets only your organization's verified AI agents, and the people you list by
their signing keys, change your codebase. Every commit in a pull request or
push (merge commits too) must carry a valid SSH signature by a key that is
either:

- an **agent's** key that Agent ID lists, at that moment, as an active agent
  of your organization whose owner meets your policy. Revoking an agent, or
  one of its keys, makes its commits fail at once; or
- a **human signer's** key from your `human-signers` list.

Who a commit *says* it is from (author or committer email) counts for
nothing: anyone can write `git commit --author="cto@acme.com"`. Unsigned
commits always fail.

It needs only Node and Git on the runner (no `npm install`), and no secret:
an organization's agents' signing keys are public. It fails closed: if Agent
ID can't be reached, the check fails.

## Set up

1. Copy your **organization id** from the Agent ID dashboard.
2. Have each agent sign its commits: `timewarp-id git setup` in the
   repository (see the CLI). Its agent must belong to the organization.
3. Have people who commit sign with an SSH key too
   (`git config gpg.format ssh`, `user.signingkey ~/.ssh/id_ed25519.pub`,
   `commit.gpgsign true`) and list their public keys in `human-signers`.
4. Add the workflow and make it a required status check in your branch
   protection rules.

```yaml
# .github/workflows/agent-id.yml
name: Agent ID
on:
  pull_request:
  push:
    branches: [main]
  merge_group:
jobs:
  commits:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # the whole history, so no commit goes unchecked
      - uses: vinceackermann2-sys/git-timework-buddy/agent-id/action@main   # or pin a commit SHA
        with:
          organization: <your organization id>
          human-signers: ${{ secrets.AGENT_ID_HUMAN_SIGNERS }}   # or: .github/allowed_signers
```

**fetch-depth.** Use `fetch-depth: 0`. With a shallow clone the action tries
to fetch the full history itself and fails if it can't, rather than skipping
commits beyond the shallow boundary.

## Inputs

| Input | |
|---|---|
| `organization` (required) | Your organization's id. |
| `api` | Agent ID's API; empty = production. |
| `base` | First commit not to check. Default: the pull request's base, the push's previous head (for a new branch, where it leaves the default branch), or the merge queue's base. |
| `head` | Last commit to check. Default: the pull request's head, the pushed commit, or the merge queue's head. |
| `human-signers` | People who sign their own commits, in Git's `allowed_signers` format, one per line: `alice@acme.com namespaces="git" ssh-ed25519 AAAA…`. Either the lines themselves, or the path of a file with them in this repository. Default: none. |

Outputs: `checked`, `failed`, `failed-commits` (comma-separated SHAs),
`agent-commits`, `human-commits`. The job summary lists every commit with its
result and who signed it, and each failing commit gets an error annotation.

## Human signers: secret or file

Whoever can change the list can let their own key in, so keep it where only
the right people can change it:

- **A secret (recommended if unsure).** Store the lines as a repository or
  organization secret and pass `human-signers: ${{ secrets.AGENT_ID_HUMAN_SIGNERS }}`.
- **A file in the repository**, e.g. `human-signers: .github/allowed_signers`.
  The action reads it **as it is in the base commit**, so a pull request that
  adds its author's key doesn't count until it has been reviewed and merged.
  Protect the file with CODEOWNERS and branch protection (required reviews
  from code owners), since whoever can merge a change to it can add keys.

## How it decides

The action downloads `GET <api>/v1/orgs/<organization>/allowed-signers` (the
active signing keys of your organization's agents whose owners are
verified), appends your human signers, writes both to one temporary
`allowed_signers` file, and runs, for every commit in `base..head`:

```sh
git -c gpg.ssh.allowedSignersFile=<file> -c gpg.minTrustLevel=fully verify-commit <sha>
```

A commit passes only when Git reports a good signature by a listed key; the
action reports whether that key was an agent's (from Agent ID) or a human
signer's, by its fingerprint. An unsigned commit, a commit signed with an
unlisted key (a revoked agent's, another organization's agent's, a
stranger's), or one signed with GPG fails.

Run it locally the same way:
`AGENT_ID_ORGANIZATION=<id> AGENT_ID_BASE=origin/main AGENT_ID_HUMAN_SIGNERS=.github/allowed_signers node verify-commits.mjs`.

Setups from before organizations were public pass a company secret
(`secret: ${{ secrets.AGENT_ID_SECRET }}`) instead of `organization`; that
still works.

## Self-hosted Git

`../hooks/pre-receive.sh` does the same check on push for Gitea, GitLab,
Gerrit or a plain SSH server. Copy it to `<repo>.git/hooks/pre-receive` (or
your server's global hooks), make it executable, and set:

- `AGENT_ID_ORGANIZATION` (or `git config agentid.organization` in the server repository);
- optionally `AGENT_ID_API` / `agentid.api`;
- optionally `AGENT_ID_HUMAN_SIGNERS_FILE` / `agentid.humanSignersFile`: an
  `allowed_signers` file on the server for people who sign their own commits.
  Keep it where only server admins can write it. If it is set but can't be
  read, pushes are rejected.

It needs bash, git 2.34+, curl and ssh-keygen; new branches are checked for
the commits no existing ref has.
