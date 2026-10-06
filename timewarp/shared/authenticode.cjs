"use strict";
const cp=require('node:child_process'),path=require('node:path'),{promisify}=require('node:util');
const command="$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $s = Get-AuthenticodeSignature -LiteralPath $env:TIMEWARP_SIGN_TARGET; [pscustomobject]@{status=[string]$s.Status;publisher=if($s.SignerCertificate){$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)}else{$null};timestamped=($null -ne $s.TimeStamperCertificate)} | ConvertTo-Json -Compress";
function shellPath(){return path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');}
function options(file){const env={...process.env,TIMEWARP_SIGN_TARGET:path.resolve(file)};for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];return{env,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:16384};}
function signature(file){return JSON.parse(cp.execFileSync(shellPath(),['-NoProfile','-NonInteractive','-Command',command],options(file)));}
async function signatureAsync(file){const{stdout}=await promisify(cp.execFile)(shellPath(),['-NoProfile','-NonInteractive','-Command',command],options(file));return JSON.parse(stdout);}
function trusted(result,publishers){return result?.status==='Valid'&&result.timestamped===true&&Array.isArray(publishers)&&publishers.length>0&&publishers.includes(result.publisher);}
async function verifyInstaller(file,publishers,probe=signatureAsync){try{return trusted(await probe(file),publishers)?null:'The update does not have a valid timestamped Timewarp signature.';}catch{return 'Timewarp could not verify the update signature; installation is blocked.';}}
module.exports={signature,signatureAsync,trusted,verifyInstaller,shellPath,options};
