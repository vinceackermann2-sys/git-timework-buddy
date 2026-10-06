"use strict";
const fs=require('node:fs'),path=require('node:path');

// Retain the pinned builder's atomic upgrade/restore behavior, but use Windows
// extended paths for its file operations. Some shipped plugin metadata paths
// exceed MAX_PATH when a user chooses a deeper installation directory.
function repairLongFiles(stage){
  if(!stage)return '';
  const groups=new Map();
  function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const source=path.join(directory,entry.name);if(entry.isDirectory())walk(source);else{if(!entry.isFile())throw new Error('NSIS inputs must be regular files.');const relative=path.relative(stage,source);if(relative.length>64){const folder=path.dirname(relative);if(!groups.has(folder))groups.set(folder,[]);groups.get(folder).push(source);}}}}
  walk(stage);
  const escape=value=>{if(/[\r\n]/.test(value))throw new Error('Invalid NSIS input path.');return value.replaceAll('$','$$').replaceAll('"','$\\"');};
  const longPath=value=>value.startsWith('\\\\')?'\\\\?\\UNC\\'+value.slice(2):'\\\\?\\'+value;
  const lines=['; The inherited 7z plugin silently omits some deep metadata paths.',
    '; Write deep files again through NSIS wide-path File operations, checking IO.',
    '!macro customFiles_x64','  !insertmacro timewarpExtendedPath $R1 $INSTDIR'];
  for(const [folder,files]of groups){lines.push('  SetOutPath "$R1\\'+escape(folder)+'"');for(const file of files){lines.push('  ClearErrors','  File "/oname='+escape(path.basename(file))+'" "'+escape(longPath(file))+'"','  IfErrors 0 +3','    SetErrorLevel 1','    Abort "Could not install Timewarp files. Choose another directory or retry."');}}
  lines.push('  SetOutPath $INSTDIR','!macroend');return lines.join('\n');
}
function generateInclude(output,stage){
  const template=fs.readFileSync(path.join(path.dirname(require.resolve('app-builder-lib/package.json')),'templates/nsis/uninstaller.nsh'),'utf8');
  const functions=template.match(/Function un\.atomicRMDir[\s\S]*?FunctionEnd\s+Function un\.restoreFiles[\s\S]*?FunctionEnd/);
  const removal=template.match(/!ifmacrodef customRemoveFiles\s+!insertmacro customRemoveFiles\s+!else\s+([\s\S]*?)\s+!endif\s+\$\{ifNot\} \$\{isKeepShortcuts\}/);
  if(!functions||!removal||!removal[1].includes('Call un.atomicRMDir')||!removal[1].includes('Call un.restoreFiles')||!removal[1].includes('RMDir /r $INSTDIR'))throw new Error('Pinned NSIS uninstaller contract changed.');
  const convert=source=>source.replaceAll('un.atomicRMDir','un.timewarpAtomicRMDir').replaceAll('un.restoreFiles','un.timewarpRestoreFiles').replaceAll('$INSTDIR','$timewarpLongInstall').replaceAll('$PLUGINSDIR','$timewarpLongTemp');
  fs.writeFileSync(output,String.raw`; File routines derived from electron-builder's MIT-licensed uninstaller.nsh.
; Keep atomic rollback on a busy file, including paths beyond MAX_PATH.
!macro timewarpExtendedPath result source
  StrCpy ${'${result}'} "\\?${'\\'}${'${source}'}"
  StrCpy $R0 ${'${source}'} 2
  ${'${If}'} $R0 == "\\"
    StrCpy $R0 ${'${source}'} "" 2
    StrCpy ${'${result}'} "\\?\UNC\$R0"
  ${'${EndIf}'}
!macroend

!ifdef BUILD_UNINSTALLER
; customRemoveFiles leaves the builder's original two routines unreferenced.
; Keep other compiler warnings fatal; only unused-function warning is expected.
!pragma warning disable 6020
Var timewarpLongInstall
Var timewarpLongTemp

!macro customRemoveFiles
  !insertmacro timewarpExtendedPath $timewarpLongInstall $INSTDIR
  !insertmacro timewarpExtendedPath $timewarpLongTemp $PLUGINSDIR
${convert(removal[1])}
!macroend
!endif

; The header hook runs after the builder defines its shared constants/macros.
!macro customHeader
!ifdef BUILD_UNINSTALLER
${convert(functions[0])}
!else
Function timewarpValidateInstallPath
  ; Short files still use the inherited copy path. Keep their full paths below
  ; MAX_PATH, allowing room for the product folder added by the directory UI.
  StrLen $R0 $INSTDIR
  ${'${IfNot}'} ${'${Silent}'}
    StrLen $R1 "${'${PRODUCT_FILENAME}'}"
    IntOp $R0 $R0 + $R1
    IntOp $R0 $R0 + 1
  ${'${EndIf}'}
  ${'${If}'} $R0 > 160
    MessageBox MB_OK|MB_ICONSTOP "Choose a shorter installation folder, then run setup again." /SD IDOK
    SetErrorLevel 1
    Quit
  ${'${EndIf}'}
FunctionEnd
Function timewarpCheckInstallPathPage
  Call timewarpValidateInstallPath
  Abort
FunctionEnd
!endif
!macroend

!ifndef BUILD_UNINSTALLER
!macro customInit
  Call timewarpValidateInstallPath
!macroend
!macro customPageAfterChangeDir
  Page custom timewarpCheckInstallPathPage
!macroend
!endif

${repairLongFiles(stage)}
`);
  return output;
}
module.exports={generateInclude};
