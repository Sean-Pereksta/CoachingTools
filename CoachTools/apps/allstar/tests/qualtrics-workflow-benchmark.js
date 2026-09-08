#!/usr/bin/env node
/* Synthetic Node benchmark: execution/DOM-construction costs, not browser paint or real-workbook startup. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..');
const baseline=process.argv[2]||'HEAD';
const engine=require('../qualtrics/individual-messages.js'),workflow=require('../qualtrics/workflow.js'),insights=require('../qualtrics/insights.js');
function element(){return {children:[],dataset:{},classList:{toggle(){}},setAttribute(){},appendChild(child){this.children.push(child);},querySelectorAll(){return [];},innerHTML:'',value:''};}
function app(html){
  const context=vm.createContext({console,performance,setTimeout,clearTimeout,window:{addEventListener(){}},document:{createElement:element,createDocumentFragment:element,getElementById(){return null;}},localStorage:{getItem(){return null;}},QualtricsIndividualMessages:engine,QualtricsInsights:insights,QualtricsWorkflow:workflow});
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('const state ='));
  vm.runInContext(script.replace(/init\(\)\.catch\([\s\S]*$/,''),context);
  vm.runInContext(`renderOpenRuleSetName=()=>{};renderRuleLibraryStats=()=>{};els.ruleList=document.createElement('div');els.ruleSearchInput={value:''};els.ruleTypeFilter={value:'all'};state.rules=Array.from({length:1000},(_,i)=>normalizeRule({id:'r'+i,title:'Rule '+i,baseName:'Report '+i,criteria:[{header:'Score',operator:'lt',value:'50'}]}));state.currentRuleId='r0';let normalizationCalls=0;const originalNormalize=normalizeRule;normalizeRule=function(rule){normalizationCalls++;return originalNormalize(rule);};`,context);
  return context;
}
const old=execFileSync('git',['show',`${baseline}:CoachTools/apps/allstar/qualtrics/generator.html`],{encoding:'utf8',maxBuffer:5e6});
const current=fs.readFileSync(path.join(root,'qualtrics/generator.html'),'utf8');
function measure(html){
  const context=app(html),samples=[];
  for(let i=0;i<12;i++){
    const start=performance.now();vm.runInContext("els.ruleList.children=[];els.ruleSearchInput.value='Rule';renderRules();",context);samples.push(performance.now()-start);
  }
  const normalizations=vm.runInContext('normalizationCalls',context);
  vm.runInContext("let hiddenRenders=0;impactPopulateViewControls=()=>{};impactRenderCoachProfile=impactRenderOverall=impactRenderTopic=()=>hiddenRenders++;state.activeTab='report';impactRenderAllViews();",context);
  return {medianSearchRenderMs:+samples.sort((a,b)=>a-b)[6].toFixed(2),ruleNormalizationsAcross12Searches:normalizations,hiddenAnalyticsRenders:vm.runInContext('hiddenRenders',context)};
}
console.log(JSON.stringify({fixture:'1000 saved rules, 12 searches matching all rules; DOM stub excludes browser layout/paint',baseline, before:measure(old),after:measure(current)},null,2));
