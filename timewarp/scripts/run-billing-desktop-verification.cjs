"use strict";
// Run the read-only verifier against the packaged app, without shipping a harness.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),resources=path.resolve(root,'../energy-testv1/app/resources'),archive=path.join(resources,'app.asar'),reports=path.join(root,'reports');
const verifier=path.join(reports,'billing-live-verify.cjs'),entry=path.join(reports,'billing-live-entry.cjs');
fs.copyFileSync(path.join(__dirname,'verify-billing-desktop.cjs'),verifier);
fs.writeFileSync(entry,"const {app}=require('electron');Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:"+JSON.stringify(resources)+"});app.setAppPath("+JSON.stringify(archive)+");require("+JSON.stringify(path.join(archive,'out/main/bootstrap.js'))+");require("+JSON.stringify(verifier)+").init({root:"+JSON.stringify(root)+",runtime:require("+JSON.stringify(path.join(archive,'out/main/timewarp/desktop/runtime.cjs'))+")});");
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const dependencyRoot=path.resolve(__dirname,'..');
const result=cp.spawnSync(require(require.resolve('electron',{paths:[dependencyRoot]})),[entry],{env,windowsHide:true,encoding:'utf8',timeout:90000});
if(result.stdout)process.stdout.write(result.stdout);
const report=JSON.parse(fs.readFileSync(path.join(reports,'billing-desktop.json'),'utf8'));
if(result.status!==0||!report.passed){if(result.stderr)process.stderr.write(result.stderr);process.exitCode=1;}
