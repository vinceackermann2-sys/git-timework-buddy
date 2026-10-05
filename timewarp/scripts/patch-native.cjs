"use strict";
const acorn=require("acorn");
function replaceFunctionBody(source, marker, body) {
  const position=source.indexOf(marker);
  if(position<0||source.indexOf(marker,position+1)>=0)throw new Error("Native function contract changed: "+marker.slice(0,70));
  const ast=acorn.parse(source,{ecmaVersion:"latest",sourceType:"module",allowReturnOutsideFunction:true});
  let found;
  const visit=node=>{
    if(!node||typeof node!=="object")return;
    if(["FunctionExpression","ArrowFunctionExpression","FunctionDeclaration"].includes(node.type)&&node.body.type==="BlockStatement"&&node.body.start<=position&&node.body.end>position&&(!found||node.body.end-node.body.start<found.end-found.start))found=node.body;
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==="object")visit(value);
  };
  visit(ast);if(!found)throw new Error("Native function boundary not found.");
  return source.slice(0,found.start)+body+source.slice(found.end);
}
function replaceMethodBody(source,className,methodName,body){
  const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),matches=[];
  const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='ClassDeclaration'&&node.id?.name===className)for(const method of node.body.body)if(method.key?.name===methodName)matches.push(method.value.body);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);};visit(ast);
  if(matches.length!==1)throw Error('Native method contract changed: '+className+'.'+methodName);
  return source.slice(0,matches[0].start)+body+source.slice(matches[0].end);
}
module.exports={replaceFunctionBody,replaceMethodBody};
