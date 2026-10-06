$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$storeIdentity = Get-Content -LiteralPath $env:TIMEWARP_STORE_CONFIG -Raw | ConvertFrom-Json
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:TIMEWARP_STORE_PACKAGE)
try {
  $names = @{}
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -match '(^/|\\|:|(^|/)\.\.(/|$))' -or $names.ContainsKey($entry.FullName.ToLowerInvariant())) { throw 'Unsafe or duplicate MSIX entry.' }
    $names[$entry.FullName.ToLowerInvariant()] = $entry
  }
  function Read-EntryText([string]$name) {
    $entry = $archive.GetEntry($name)
    if (-not $entry) { throw "Missing MSIX entry: $name" }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { $reader.ReadToEnd() } finally { $reader.Dispose() }
  }
  [xml]$manifest = Read-EntryText 'AppxManifest.xml'
  $identity = $manifest.Package.Identity
  if ($identity.Name -cne $storeIdentity.identityName -or $identity.Publisher -cne $storeIdentity.publisher -or $identity.Version -ne ($storeIdentity.version + '.0') -or $identity.ProcessorArchitecture -ne 'x64') { throw 'MSIX identity/version does not match the existing Store listing.' }
  $application = @($manifest.Package.Applications.Application)
  if ($application.Count -ne 1 -or $application[0].Id -cne $storeIdentity.applicationId -or $application[0].Executable -cne 'app\Timewarp.exe' -or $application[0].EntryPoint -ne 'Windows.FullTrustApplication') { throw 'Incorrect Store executable or application ID.' }
  if ($manifest.Package.Properties.DisplayName -cne $storeIdentity.displayName -or $manifest.Package.Properties.PublisherDisplayName -cne $storeIdentity.publisherDisplayName) { throw 'Incorrect Store display identity.' }
  $capabilities = @($manifest.Package.Capabilities.ChildNodes | Where-Object { $_.NodeType -eq 'Element' })
  if ($capabilities.Count -ne 1 -or $capabilities[0].GetAttribute('Name') -ne 'runFullTrust') { throw 'Unexpected Store capability.' }
  if ($names.ContainsKey('app/resources/app-update.yml')) { throw 'Store packages must use Store updates.' }
  if ($names.ContainsKey('appxsignature.p7x')) { throw 'The submission container must be unsigned for Microsoft Store signing.' }
  $runtimeDirectory = [System.IO.Path]::GetFullPath($env:TIMEWARP_STORE_STAGE)
  $files = @(Get-ChildItem -LiteralPath $runtimeDirectory -File -Recurse)
  if (@($archive.Entries | Where-Object { $_.FullName.StartsWith('app/') -and -not $_.FullName.EndsWith('/') }).Count -ne $files.Count) { throw 'MSIX payload inventory differs from staging.' }
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($runtimeDirectory.Length + 1).Replace('\','/')
    $entry = $archive.GetEntry('app/' + $relative)
    if (-not $entry -or $entry.Length -ne $file.Length) { throw "Missing/incomplete MSIX payload: $relative" }
    $stream = $entry.Open()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose(); $sha.Dispose() }
    if ($digest -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { throw "MSIX payload hash mismatch: $relative" }
  }
  if (-not $archive.GetEntry('AppxBlockMap.xml') -or -not $archive.GetEntry('[Content_Types].xml')) { throw 'Missing MSIX packaging metadata.' }
  [ordered]@{ identity=$identity.Name; publisher=$identity.Publisher; version=$identity.Version; architecture=$identity.ProcessorArchitecture; applicationId=$application[0].Id; verifiedPayloadFiles=$files.Count; storeId=$storeIdentity.storeId; signed=$false; storeValidation='pending'; installedAcceptance='pending' } | ConvertTo-Json -Compress
} finally { $archive.Dispose() }
