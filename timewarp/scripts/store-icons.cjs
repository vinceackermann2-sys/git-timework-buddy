"use strict";
const fs=require('node:fs'),path=require('node:path');
const sharp=require('sharp');

// Windows uses target-size assets for the taskbar, Start and search. Both
// unplated theme variants are required to prevent a system background plate.
// https://learn.microsoft.com/windows/apps/design/iconography/app-icon-construction
const targetSizes=[16,20,24,30,32,36,40,48,60,64,72,80,96,256];
const iconAssets=[
  {name:'StoreLogo.png',width:50,height:50},
  {name:'Square44x44Logo.png',width:44,height:44},
  {name:'Square150x150Logo.png',width:150,height:150},
  {name:'Wide310x150Logo.png',width:310,height:150},
  ...[44,150].flatMap(base=>[100,200,400].map(scale=>({
    name:`Square${base}x${base}Logo.scale-${scale}.png`,
    width:base*scale/100,height:base*scale/100
  }))),
  ...targetSizes.flatMap(size=>['','_altform-unplated','_altform-lightunplated'].map(form=>({
    name:`Square44x44Logo.targetsize-${size}${form}.png`,width:size,height:size
  })))
];

async function buildStoreIcons(source,directory){
  fs.mkdirSync(directory,{recursive:true});
  for(const {name,width,height} of iconAssets){
    await sharp(source).resize(width,height,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(path.join(directory,name));
  }
}

async function verifyStoreIcons(directory){
  for(const {name,width,height} of iconAssets){
    const file=path.join(directory,name),metadata=await sharp(file).metadata();
    if(metadata.width!==width||metadata.height!==height||!metadata.hasAlpha)throw new Error(`Incorrect Store icon dimensions or missing alpha: ${name}`);
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let visible=false;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const alpha=data[(y*width+x)*info.channels+info.channels-1];
      if(alpha)visible=true;
      // Lanczos resizing can leave nearly invisible ringing at small sizes.
      if((x===0||y===0||x===width-1||y===height-1)&&alpha>4)throw new Error(`Store icon has a background at its edge: ${name}`);
      if((x===0||x===width-1)&&(y===0||y===height-1)&&alpha!==0)throw new Error(`Store icon has a background at its corner: ${name}`);
    }
    if(!visible)throw new Error(`Store icon is empty: ${name}`);
  }
  return iconAssets.length;
}

module.exports={buildStoreIcons,verifyStoreIcons};
