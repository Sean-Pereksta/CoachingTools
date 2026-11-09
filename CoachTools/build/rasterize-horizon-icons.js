#!/usr/bin/env node
'use strict';
// SVG files remain editable masters. The shipped UI consumes individual PNGs.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'icons/horizon');
const moduleIndex=process.argv.indexOf('--sharp-module');
let sharp;
try { sharp=require(moduleIndex>=0?process.argv[moduleIndex+1]:'sharp'); }
catch { throw new Error('PNG regeneration needs sharp. Install it for development or pass --sharp-module with its installed module path. Shipped PNGs need no dependencies.'); }
(async()=>{
  const files=fs.readdirSync(dir).filter(file=>file.endsWith('.svg'));
  for(const file of files)await sharp(path.join(dir,file),{density:384}).resize(512,512).png().toFile(path.join(dir,file.replace(/\.svg$/,'.png')));
  // Windows launcher images use the same Horizon artwork as the desktop.
  const home=path.join(dir,'coachtools-home.png');
  for(const name of ['coachtools-home.png','coachtools-galaxy.png'])fs.copyFileSync(home,path.join(root,'icons',name));
  const image=await sharp(home).resize(256,256).png().toBuffer(),header=Buffer.alloc(22);
  header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=0;header[7]=0;
  header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
  fs.writeFileSync(path.join(root,'icons/coachtools-galaxy.ico'),Buffer.concat([header,image]));
  console.log('Rendered '+files.length+' individual Horizon PNG icons at 512 × 512, plus the Windows launcher icon.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
