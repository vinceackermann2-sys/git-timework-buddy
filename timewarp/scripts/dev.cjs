"use strict";
// Development opens the same packaged desktop; the separate browser UI retired.
const {spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const executable=path.resolve(__dirname,'../../timewarp-runtime/app/Timewarp.exe');
if(!fs.existsSync(executable))throw new Error('Run npm run build first.');
const child=spawn(executable,[],{cwd:path.dirname(executable),detached:true,stdio:'ignore',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.unref();
console.log('Opened the single Timewarp desktop app.');
