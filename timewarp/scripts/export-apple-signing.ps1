param(
  [Parameter(Mandatory=$true)][string]$Certificate,
  [string]$TeamId = '6XD78664VT',
  [string]$OpenSsl = 'C:\Program Files\Git\usr\bin\openssl.exe'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $TeamId -notmatch '^[A-Z0-9]{10}$') { throw 'Windows DPAPI identity and a valid Apple team are required.' }
$signingDirectory = Join-Path $env:LOCALAPPDATA "Timewarp\signing\apple-$TeamId"
$keyPath = Join-Path $signingDirectory 'developer-id.key.pem'
$passwordPath = Join-Path $signingDirectory 'password.dpapi'
$pemPath = Join-Path $signingDirectory 'developer-id.cert.pem'
$p12Path = Join-Path $signingDirectory 'developer-id.p12'
$caPath = Join-Path $signingDirectory 'developer-id-g2.cer'
$caPemPath = Join-Path $signingDirectory 'developer-id-g2.pem'
$securePassword = Get-Content -LiteralPath $passwordPath -Raw | ConvertTo-SecureString
try {
  $env:TIMEWARP_CSR_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
  & $OpenSsl x509 -inform DER -in $Certificate -out $pemPath
  if ($LASTEXITCODE -ne 0) { throw 'Invalid Apple certificate.' }
  $details = (& $OpenSsl x509 -in $pemPath -noout -subject -text) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $details -notmatch 'CN=Developer ID Application:' -or $details -notmatch "OU=$TeamId" -or $details -notmatch '1\.2\.840\.113635\.100\.6\.1\.13') { throw 'Expected a Developer ID Application certificate for this team.' }
  $certPublicKey = (& $OpenSsl x509 -in $pemPath -pubkey -noout) -join "`n"
  $privatePublicKey = (& $OpenSsl pkey -in $keyPath -passin env:TIMEWARP_CSR_PASSWORD -pubout) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $certPublicKey -ne $privatePublicKey) { throw 'The certificate does not match the retained private key.' }
  Invoke-WebRequest -Uri 'https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer' -OutFile $caPath
  & $OpenSsl x509 -inform DER -in $caPath -out $caPemPath
  if ($LASTEXITCODE -ne 0) { throw 'Invalid Apple G2 intermediary.' }
  # Apple's Security import requires the interoperable PKCS#12 PBE/MAC format.
  # Keep the high-entropy protected password and an explicit iteration count.
  & $OpenSsl pkcs12 -export -inkey $keyPath -in $pemPath -certfile $caPemPath -passin env:TIMEWARP_CSR_PASSWORD -passout env:TIMEWARP_CSR_PASSWORD -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -iter 100000 -out $p12Path -name "Developer ID Application ($TeamId)"
  if ($LASTEXITCODE -ne 0) { throw 'Signing identity export failed.' }
  & $OpenSsl x509 -in $pemPath -noout -subject -dates -fingerprint -sha256
} finally {
  Remove-Item Env:TIMEWARP_CSR_PASSWORD -ErrorAction SilentlyContinue
}
Write-Output "Verified protected signing identity: $p12Path"
Write-Output 'The private key and password were not printed or uploaded.'
