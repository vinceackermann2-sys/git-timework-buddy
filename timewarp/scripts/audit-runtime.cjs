"use strict";
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),app=path.join(root,'build/app'),output=path.join(root,'build/runtime-audit');
const metadata=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8'));
const packages={'':{name:metadata.name,version:metadata.version,dependencies:metadata.dependencies}},inventory=[];
function visit(modules){
  if(!fs.existsSync(modules))return;
  for(const entry of fs.readdirSync(modules,{withFileTypes:true})){
    if(entry.name.startsWith('.')||!entry.isDirectory())continue;
    const directory=path.join(modules,entry.name);
    if(entry.name.startsWith('@')){visit(directory);continue;}
    const file=path.join(directory,'package.json');if(!fs.existsSync(file))continue;
    const pkg=JSON.parse(fs.readFileSync(file,'utf8')),relative=path.relative(app,directory).replaceAll('\\','/');
    packages[relative]={name:pkg.name,version:pkg.version,dependencies:pkg.dependencies,optionalDependencies:pkg.optionalDependencies};
    inventory.push({name:pkg.name,version:pkg.version,path:relative,license:pkg.license||null});visit(path.join(directory,'node_modules'));
  }
}
visit(path.join(app,'node_modules'));if(!inventory.length)throw new Error('Shipped module inventory is empty. Stage the app first.');
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(root,'reports'),{recursive:true});
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify({name:metadata.name,version:metadata.version,private:true,dependencies:metadata.dependencies},null,2));
fs.writeFileSync(path.join(output,'package-lock.json'),JSON.stringify({name:metadata.name,version:metadata.version,lockfileVersion:3,requires:true,packages},null,2));
fs.writeFileSync(path.join(root,'reports/runtime-inventory.json'),JSON.stringify({generatedAt:new Date().toISOString(),upstreamElectron:require('../upstream-lock.json').electronVersion,modules:inventory.sort((a,b)=>a.path.localeCompare(b.path)),coverage:'Installed npm modules in app.asar; compiled-in libraries, Chromium, native binaries and Deno imports require separate review.'},null,2));
// npm is invoked through its JS CLI to avoid cmd.exe argument interpolation.
const npm=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const result=cp.spawnSync(process.execPath,[npm,'audit','--json','--package-lock-only'],{cwd:output,encoding:'utf8',windowsHide:true});
if(result.error)throw result.error;
let report;try{report=JSON.parse(result.stdout);}catch{throw new Error('Runtime dependency audit returned no JSON report.');}
fs.writeFileSync(path.join(root,'reports/runtime-audit.json'),JSON.stringify(report,null,2));
if(report.error)throw new Error('Runtime dependency audit failed: '+String(report.error.code||'unknown'));
console.log(JSON.stringify({modules:inventory.length,vulnerabilities:report.metadata?.vulnerabilities}));
if(result.status!==0)process.exitCode=1;
