#!/usr/bin/env node
'use strict';
// Package genuine generated raster originals. No vector rendering takes place.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1];};
const source=argument('--source-directory');
if(!source)throw new Error('Pass --source-directory containing the approved original PNG artwork and horizon-wordmark.png.');
let sharp;try{sharp=require(argument('--sharp-module')||'sharp');}catch{throw new Error('Asset packaging requires sharp; pass --sharp-module with its installed path.');}
const apps=JSON.parse(fs.readFileSync(path.join(ROOT,'apps.json'),'utf8')).apps;
const roles=[...new Set([...apps.map(app=>app.id),'all-star-tools','coach-analytics-tools','general-apps','data-building','under-construction','coachtools-home','start','shared-data','backup-restore','settings','all-apps','default-app','update-data','clean-upload','submit-feedback'])];
const aliases={'allstar':'allstar','verification-all-star':'verification-all-star','weekly-data':'weekly-data','coaching-gaps':'coaching-gaps','coach-timeline':'coach-timeline','kpi-impact':'kpi-impact','qa-scores':'qa-scores','audit-checklist':'audit-checklist','all-star-tools':'all-star-tools','analyticsfolder':'coach-analytics-tools','otherfolder':'general-apps','underconstructionfolder':'under-construction','shared-data':'shared-data','backup-restore':'backup-restore','settings':'settings','default-app':'default-app','all-apps':'all-apps','scorecard':'performance-scorecard','databuilder':'weekly-data-builder','checklist-and-documentation':'contact-center-checklist','video-player':'video-library','calculator':'weekly-comparison','coachtools-home':'coachtools-home','coachtools-galaxy':'coachtools-home'};
(async()=>{
  // Validate the complete approved set before changing any shipped assets.
  for(const id of [...roles,'horizon-wordmark']){
    const metadata=await sharp(path.join(source,id+'.png')).metadata();
    if(metadata.format!=='png'||metadata.width<512||metadata.height<256)throw new Error('Invalid high-resolution PNG for '+id);
    if(id!=='horizon-wordmark'&&Math.abs(metadata.width/metadata.height-1)>.12)throw new Error('Icon is not square: '+id);
  }
  const directory=path.join(ROOT,'icons/horizon');fs.mkdirSync(directory,{recursive:true});
  for(const id of roles)await sharp(path.join(source,id+'.png')).resize(512,512,{fit:'contain',background:'#00000000'}).png({compressionLevel:9}).toFile(path.join(directory,id+'.png'));
  await sharp(path.join(source,'horizon-wordmark.png')).trim().resize({width:1400,withoutEnlargement:true}).png({compressionLevel:9}).toFile(path.join(ROOT,'graphics/horizon-logo.png'));
  for(const [target,id] of Object.entries(aliases))fs.copyFileSync(path.join(directory,id+'.png'),path.join(ROOT,'icons',target+'.png'));
  const image=await sharp(path.join(directory,'coachtools-home.png')).resize(256,256).png().toBuffer(),header=Buffer.alloc(22);
  header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
  fs.writeFileSync(path.join(ROOT,'icons/coachtools-galaxy.ico'),Buffer.concat([header,image]));
  console.log('Installed '+roles.length+' image-generated PNG icons, the Horizon brand lockup, and the Windows shortcut icon.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
