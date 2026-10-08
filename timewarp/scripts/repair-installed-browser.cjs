"use strict";
// Prepare verified launchers for an installed MSIX. The old desktop overrides
// shell PATH on the app-server command line, so editing config.toml alone does
// not repair it. Normal `browser` commands require the patched desktop build.
const path=require('node:path');
const {prepareHarnessPath}=require('../desktop/harness-path.cjs');
const argument=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(name+' is required');return path.resolve(process.argv[i+1]);};
const packageRoot=argument('--package-root'),home=argument('--home');
const directory=prepareHarnessPath(packageRoot,home);
console.log('Prepared verified launchers at '+directory+'. The patched desktop build is required to select them automatically. The old installed build can only use the explicit executable path.');
