// What Agent ID runs on an agent's computer, as shell. The computer's commands
// arrive as root; the agent's own commands are then run as an ordinary user
// ("agent"), so they can't read the vault's folder or see its processes. The
// vault runs as its own locked account ("vault"). Nothing secret is ever put
// on a command line: vault items travel sealed.
import { toBase64, utf8 } from '../util.ts';
import { VAULT_VM_SCRIPT } from './vm-script.ts';

const b64 = (text: string) => toBase64(utf8(text));
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export const VAULT_HOME = '/var/lib/agent-id-vault';
const VAULT_BIN = '/opt/agent-id-vault';
const NODE = `${VAULT_BIN}/node/bin/node`;
// Node for the vault, kept apart from any the agent installs.
const NODE_VERSION = 'v20.18.1';

// Hides other accounts' processes from the agent (best effort: some
// computers don't allow it, and nothing secret is ever on a command line).
const HIDE_PROCESSES = 'mount -o remount,hidepid=2 /proc 2>/dev/null || true';

// The agent's account, made the first time. On a computer from before the
// agent ran as an ordinary user, its files in root's home come along.
const AGENT_ACCOUNT = 'id -u agent >/dev/null 2>&1 || { useradd -m -s /bin/bash agent && cp -a /root/. /home/agent/ 2>/dev/null; chown -R agent:agent /home/agent; }';

// An agent's command, as the agent's account, in its folder (~ is its home).
export function agentCommand(command: string, cwd?: string) {
  const inner = 'd="$1"; case "$d" in "~"|"~/"*) d="$HOME${d#\\~}";; esac; cd -- "$d" || exit 1; eval "$(printf %s "$2" | base64 -d)"';
  const env = 'env -i HOME=/home/agent USER=agent LOGNAME=agent LANG=C.UTF-8 TERM=xterm-256color PATH=/home/agent/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin TIMEWARP_AGENT_ID="$TIMEWARP_AGENT_ID"';
  const asAgent = `runuser -u agent -- ${env} bash -lc ${shellQuote(inner)} _ ${shellQuote(cwd || '~')} ${b64(command)}`;
  // Where the computer doesn't run commands as root, they run as they always did.
  const direct = `bash -lc ${shellQuote(inner)} _ ${shellQuote(cwd || '~')} ${b64(command)}`;
  return `if [ "$(id -u)" = 0 ]; then ${AGENT_ACCOUNT}; ${HIDE_PROCESSES}; exec ${asAgent}; else exec ${direct}; fi`;
}

// System packages, now that the agent isn't root: from the system's own
// signed sources, by name only.
export const PACKAGE = /^[a-z0-9][a-z0-9+.-]{0,99}$/;
export function installCommand(packages: string[]) {
  return `export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends -- ${packages.map(shellQuote).join(' ')}`;
}

// Setting the vault up (again): its account and folder, Node for it (checked
// against nodejs.org's published sums, downloaded where only root can write),
// the vault program, and its key pair. Prints the public key as JSON.
export function vaultSetupCommand() {
  const node = [
    `if [ ! -x ${NODE} ]; then`,
    '  command -v curl >/dev/null && command -v xz >/dev/null || { apt-get update -qq && apt-get install -y -qq curl xz-utils ca-certificates >/dev/null; }',
    '  case "$(uname -m)" in x86_64) A=x64;; aarch64|arm64) A=arm64;; *) echo \'{"error":{"code":"unsupported","message":"The vault does not support this computer\\u0027s processor."}}\'; exit 3;; esac',
    `  V=${NODE_VERSION}; F="node-$V-linux-$A.tar.xz"; T="$(mktemp -d)"`,
    '  curl -fsSL -o "$T/$F" "https://nodejs.org/dist/$V/$F" && curl -fsSL "https://nodejs.org/dist/$V/SHASUMS256.txt" | grep " $F$" | (cd "$T" && sha256sum -c - >/dev/null)',
    `  mkdir -p ${VAULT_BIN}/node && tar -xJf "$T/$F" -C ${VAULT_BIN}/node --strip-components=1 && rm -rf "$T"`,
    'fi',
  ];
  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    AGENT_ACCOUNT,
    `id -u vault >/dev/null 2>&1 || useradd -r -M -d ${VAULT_HOME} -s /usr/sbin/nologin vault`,
    `install -d -m 700 -o vault -g vault ${VAULT_HOME}`,
    `install -d -m 755 -o root -g root ${VAULT_BIN}`,
    // No way into root with a password.
    'passwd -l root >/dev/null 2>&1 || true',
    ...node,
    vaultOpCommand('init', {}),
  ].join('\n');
}

// One vault operation, as the vault's account. The program is written fresh
// each time (root's, readable by all, writable by none but root).
export function vaultOpCommand(op: 'init' | 'put' | 'remove' | 'request', input: Record<string, unknown>) {
  return [
    HIDE_PROCESSES,
    `printf %s ${b64(VAULT_VM_SCRIPT)} | base64 -d > ${VAULT_BIN}/vault.js.new && chmod 644 ${VAULT_BIN}/vault.js.new && mv ${VAULT_BIN}/vault.js.new ${VAULT_BIN}/vault.js`,
    `runuser -u vault -- env -i HOME=${VAULT_HOME} LANG=C.UTF-8 ${NODE} ${VAULT_BIN}/vault.js ${op} ${b64(JSON.stringify(input))}`,
  ].join('; ');
}
