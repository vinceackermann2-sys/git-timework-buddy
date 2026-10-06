"use strict";
// Extract only the original app's data transformer; never execute its startup,
// Electron hooks, or network code. This catches bridge/client format mismatches.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),acorn=require('acorn');
module.exports=function originalWire(){
  const source=fs.readFileSync(path.resolve(__dirname,'../build/app/out/main/index.js'),'utf8'),definitions=new Map();
  for(const node of acorn.parse(source,{ecmaVersion:'latest'}).body){
    if(['ClassDeclaration','FunctionDeclaration'].includes(node.type)&&node.id)definitions.set(node.id.name,source.slice(node.start,node.end));
    if(node.type==='VariableDeclaration')for(const item of node.declarations)if(item.id.type==='Identifier'&&item.init)definitions.set(item.id.name,source.slice(item.init.start,item.init.end));
  }
  const context=vm.createContext({URL,URLSearchParams});
  function load(name){const expression=definitions.get(name);if(!expression)throw Error('Unexpected transformer dependency: '+name);context[name]=run('('+expression+')');}
  function run(expression){for(let attempt=0;attempt<150;attempt++)try{return vm.runInContext(expression,context,{timeout:1000});}catch(error){const dependency=/^([\w$]+) is not defined$/.exec(error.message);if(!dependency)throw error;load(dependency[1]);}throw Error('Transformer dependency limit exceeded.');}
  context.transformer=run('new me()');
  return {serialize(value){context.value=value;return JSON.parse(JSON.stringify(run('transformer.serialize(value)')));},deserialize(value){context.value=value;const result=run('transformer.deserialize(value)');return result===undefined?undefined:JSON.parse(JSON.stringify(result));}};
};
