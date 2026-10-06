"use strict";
const path = require('node:path'), cp = require('node:child_process');
const {signature,trusted,shellPath,options:signatureOptions}=require('../shared/authenticode.cjs');
function requireSignature(file, publishers) {
  const result = signature(file);
  if (!trusted(result,publishers)) throw new Error('A valid timestamped Timewarp signature is required: ' + path.basename(file));
  return result;
}
async function signFile(file) {
  if (process.env.TIMEWARP_SIGN_SCRIPT) {
    const signer = require(path.resolve(process.env.TIMEWARP_SIGN_SCRIPT));
    await signer(path.resolve(file));
    return;
  }
  // A custom signer can use Trusted Signing, a hardware token or signtool.
  // The default supports a Windows certificate thumbprint or a local PFX.
  const command = `$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; if($env:TIMEWARP_CERT_SHA1){$cert=Get-Item -LiteralPath ('Cert:\\CurrentUser\\My\\'+$env:TIMEWARP_CERT_SHA1)} elseif($env:WIN_CSC_LINK -and (Test-Path -LiteralPath $env:WIN_CSC_LINK)){$cert=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new($env:WIN_CSC_LINK,$env:WIN_CSC_KEY_PASSWORD,[System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)} else {throw 'A signing certificate or custom signing service is required.'}; if(-not $cert.HasPrivateKey){throw 'The signing certificate has no private key.'}; $result=Set-AuthenticodeSignature -LiteralPath $env:TIMEWARP_SIGN_TARGET -Certificate $cert -HashAlgorithm SHA256 -IncludeChain All -TimestampServer 'https://timestamp.digicert.com'; if($result.Status -ne 'Valid'){throw 'Authenticode signing did not produce a valid signature.'}`;
  try { cp.execFileSync(shellPath(), ['-NoProfile','-NonInteractive','-Command', command], { ...signatureOptions(file), timeout:120000, stdio: 'pipe' }); }
  catch { throw new Error('Timewarp signing failed. Check the certificate/service and timestamp connectivity.'); }
}
module.exports = { signature, requireSignature, signFile };
