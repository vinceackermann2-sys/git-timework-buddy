param(
  [string]$TeamId = '6XD78664VT',
  [string]$CommonName = 'Vincent Ackermann',
  [string]$OpenSsl = 'C:\Program Files\Git\usr\bin\openssl.exe'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This helper protects the identity with Windows DPAPI. Use Keychain Access on a Mac.' }
if ($TeamId -notmatch '^[A-Z0-9]{10}$' -or $CommonName -match '[/\r\n]') { throw 'Invalid certificate subject.' }
if (-not (Test-Path -LiteralPath $OpenSsl -PathType Leaf)) { throw 'OpenSSL is required.' }
$signingDirectory = Join-Path $env:LOCALAPPDATA "Timewarp\signing\apple-$TeamId"
$keyPath = Join-Path $signingDirectory 'developer-id.key.pem'
$passwordPath = Join-Path $signingDirectory 'password.dpapi'
$csrPath = Join-Path $signingDirectory 'developer-id.csr'
if (Test-Path -LiteralPath $csrPath) {
  if (-not ((Test-Path -LiteralPath $keyPath) -and (Test-Path -LiteralPath $passwordPath))) { throw 'An incomplete signing identity exists; inspect it before retrying.' }
  & $OpenSsl req -in $csrPath -verify -noout
  if ($LASTEXITCODE -ne 0) { throw 'Existing CSR validation failed.' }
  Write-Output "Existing CSR: $csrPath"
  exit
}
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$identitySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$directoryAcl = New-Object System.Security.AccessControl.DirectorySecurity
$directoryAcl.SetAccessRuleProtection($true, $false)
$directoryAcl.SetOwner($identitySid)
foreach ($sid in @($identitySid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $directoryAcl.AddAccessRule($rule)
}
[System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.DirectoryInfo]::new($signingDirectory), $directoryAcl)
if ((Test-Path -LiteralPath $keyPath) -ne (Test-Path -LiteralPath $passwordPath)) { throw 'An incomplete private key exists; inspect it before retrying.' }
if (Test-Path -LiteralPath $keyPath) {
  $securePassword = Get-Content -LiteralPath $passwordPath -Raw | ConvertTo-SecureString
  $password = [System.Net.NetworkCredential]::new('', $securePassword).Password
} else {
$randomBytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($randomBytes)
$rng.Dispose()
$password = [Convert]::ToBase64String($randomBytes)
[Array]::Clear($randomBytes, 0, $randomBytes.Length)
$protected = ConvertTo-SecureString $password -AsPlainText -Force | ConvertFrom-SecureString
[IO.File]::WriteAllText($passwordPath, $protected)
}
try {
  $env:TIMEWARP_CSR_PASSWORD = $password
  if (-not (Test-Path -LiteralPath $keyPath)) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $OpenSsl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -aes-256-cbc -pass env:TIMEWARP_CSR_PASSWORD -out $keyPath 2>$null
    $ErrorActionPreference = $previousPreference
    if ($LASTEXITCODE -ne 0) { throw 'Private key generation failed.' }
  }
  & $OpenSsl req -new -sha256 -key $keyPath -passin env:TIMEWARP_CSR_PASSWORD -subj "/CN=$CommonName/OU=$TeamId" -out $csrPath
  if ($LASTEXITCODE -ne 0) { throw 'CSR generation failed.' }
  & $OpenSsl req -in $csrPath -verify -noout
  if ($LASTEXITCODE -ne 0) { throw 'CSR validation failed.' }
} finally {
  Remove-Item Env:TIMEWARP_CSR_PASSWORD -ErrorAction SilentlyContinue
  $password = $null
}
Write-Output "CSR: $csrPath"
Write-Output 'The encrypted private key and DPAPI-protected password remain in a restricted local directory outside OneDrive. Only upload the CSR to Apple.'
