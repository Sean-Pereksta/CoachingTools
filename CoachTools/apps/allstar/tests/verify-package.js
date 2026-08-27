#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sourcePath=p=>path.join(root,p);
const read=p=>fs.readFileSync(sourcePath(p),'utf8');
const files=['allstar.html','css/allstar.css','js/core.js','js/persistence.js','js/models.js','js/imports.js','js/calculations.js','js/research.js','js/organizations-core.js','js/workflow.js','js/list-tester.js','js/reports.js','js/qualtrics-bridge.js','js/app.js','qualtrics/generator.html','qualtrics/insights.js','qualtrics/generator-source.js','tests/regression-tests.js','tests/qualtrics-insights.test.js','build/build-portable.js','dist/All-Star-Portable.html','README.txt','PERSISTENCE-CONTRACTS.txt','REFACTOR-MANIFEST.json','SIZE-REPORT.txt','VALIDATION.txt'];
let failed=false;
function check(name,pass,detail=''){ console.log((pass?'PASS':'FAIL')+' '+name+(detail?' — '+detail:'')); if(!pass) failed=true; }
for(const file of files) check('exists: '+file,fs.existsSync(sourcePath(file)));
const html=read('allstar.html'), generator=read('qualtrics/generator.html'), portable=read('dist/All-Star-Portable.html');
const imports=read('js/imports.js'), app=read('js/app.js'), models=read('js/models.js'), persistence=read('js/persistence.js'), workflow=read('js/workflow.js'), research=read('js/research.js'), regressionTests=read('tests/regression-tests.js');
check('modular HTML has no embedded legacy generator',!html.includes('qualtricsGeneratorSource'));
check('modular source has no runtime patch engine',!files.filter(f=>f.startsWith('js/')).some(f=>read(f).includes('patchQualtricsGeneratorSource')));
check('generator is permanently patched',['ruleDisplayColumnEnabled','ruleDisplayTextTemplate','Representatives Identified','Rule-specific evidence:','correctiveContextEnabled','Organization Opportunity Summary','QualtricsInsights','allstar-clear-data','exportUrgencyPdfBtn','simpleQualtricsExecutiveMatrixHtml'].every(x=>generator.includes(x))&&read('qualtrics/insights.js').includes('Corrective History + Current Need'));
check('Qualtrics concern history counts loaded names and remains portable',['concernOccurrenceKey','classifyConcernHistory','summarizeConcernNameCounts','Concern History Loaded','Show first 50','concernHistoryNameCount','Appearance History','Summary','All-Star Representative Key','coachMatch(rec,rule,reportDate,3)','Review Option</strong> = repeated concern despite related coaching'].every(x=>(generator+'\n'+read('qualtrics/insights.js')+'\n'+read('js/qualtrics-bridge.js')).includes(x))&&portable.includes('qualtrics_concern_history_'));
check('Display Column implementation retained',read('js/calculations.js').includes('function displayColumnValue')&&generator.includes('ruleDisplayColumnEnabled')&&generator.includes('displayColumn.template'));
check('manual tests are not a normal script dependency',!html.includes('src="tests/regression-tests.js"'));
check('portable has no first-party file dependency',!/<(?:link[^>]+href|script[^>]+src)="(?:css|js|qualtrics)\//i.test(portable));
check('portable contains final generator',['allstar-clear-data','simpleQualtricsExecutiveMatrixHtml','QualtricsInsights','Organization Opportunity Summary'].every(x=>portable.includes(x)));
const contracts=['allStarStandaloneModels.v1','allStarResearchItems.v1','allStarImportedDataCache.v1','allStarResearchRenderedResults.v1','allStarResearchMetricsDb.v1','allStarOrgBuilder.v1','allStarRepAliases.v1','allStarRunSettings.v2','allStarPdfOptions.v1','allStarRunPresets.v1','allStarSavedReports.v1','coachingEmailGeneratorDB','coachingEmailGeneratorOrganizationSummary.v1'];
const code=files.filter(f=>f.startsWith('js/')||f==='qualtrics/generator.html').map(read).join('\n');
check('generalized lookup display fields present',['lookupDisplayIndex','lookupSelection','lookupMatchEntity','Coach Name Expected In'].every(x=>code.includes(x)));
check('normalized JSON package contract present',['All_Star_Data_Package.json','allstar-data-package','stageAllStarJsonPackage','loadJsonPackageFile'].every(x=>code.includes(x)));
check('lazy import and versioned Research caches present',['workbookAoaCache','sheetAoaPreview','workbookSheetsNeededForImport','researchQueryFilterCacheKey','baseCohortSignature','versioned filter-position cache'].every(x=>code.includes(x)));
check('categorization is manual-only and stale sources block reports',imports.includes('directButtonClick')&&imports.includes('trigger.isTrusted===true')&&imports.includes('Automatic categorization request blocked')&&!imports.includes('categorizeImportedData({automatic:true')&&app.includes('categorizeImportedData({manual:true')&&read('js/workflow.js').includes('Categorization Needed')&&read('js/workflow.js').includes('press Categorize Data')&&portable.includes('Categorization runs only when you press this button.'));
check('manual categorization reuses safe source fragments',['categorizationPackSignature','buildCategorizedSourceFragment','previousFragments','reused.push','performance.now()-sliceStart>=8','invalidateCategorizedConsumers'].every(x=>imports.includes(x)));
check('Allstar startup has one monotonic progress owner',models.includes('createAllStarStartupJob')&&models.includes('job.preventedRegressions++')&&app.includes('async function startAllStar()'));
check('Allstar regression suite instruments monotonic startup progress',regressionTests.includes('runAllStarStartupLifecycleRegressionTests')&&regressionTests.includes('nextPercent>=percentages[index-1]'));
check('startup restores workbook metadata without expanding worksheet AOAs',persistence.includes("IDBKeyRange.bound('book:','book:\\uffff')")&&persistence.includes('workbookSheetsExpanded:0')&&persistence.includes('full index deferred'));
check('startup defers hidden UI, Research results, and derived index rebuilds',app.includes('startup:true')&&app.includes('loadResearchItems({definitionsOnly:true})')&&research.includes('if(options.definitionsOnly)')&&!persistence.includes('applyRepAliasMappingsToAllRows'));
check('startup diagnostics report cache reuse and manual categorization safety',['sourceDatasetsLoaded','indexesReused','indexesRebuilt','categorizedDataTouched:false','slowOperations'].every(value=>app.includes(value)||persistence.includes(value)));
check('Import workflow is grouped into current data, update, and advanced tools',['Current CoachingTools Data','Update CoachingTools Data','Data Tools','Local Cache','renderImportWorkspace'].every(value=>html.includes(value)||workflow.includes(value)));
check('source changes invalidate source indexes selectively',models.includes('affectedSources.forEach(source=>')&&models.includes('researchSourceIndexes?.delete?.(source)')&&models.includes('invalidateRunSourceIndex(source,reason)'));
check('central reconciliation is metadata-first and direct',imports.includes('getDatasetVersion(datasetType)')&&imports.includes('directWorkbookFromCoachToolsDataset')&&!imports.includes('function sheetJsWorkbookFromCoachToolsDataset'));
check('central refresh batches one persistence commit and final render',imports.includes("flushImportCacheSave('central CoachTools batch complete'")&&imports.includes('renderAllStarAfterDataBatch')&&imports.includes('beginAllStarCentralStage'));
check('close lifecycle uses handshake and no duplicate full flush',app.includes("type:'coachtools:close-ready'")&&app.includes("type==='coachtools:prepare-close'")&&!app.includes("flushImportCacheSave('pagehide flush')")&&!app.includes("flushImportCacheSave('visibilitychange flush')"));
for(const contract of contracts) check('persistence contract: '+contract,code.includes(contract));
try{ new Function(files.filter(f=>f.startsWith('js/')).map(read).join('\n')); check('combined application JavaScript parses',true); }catch(error){ check('combined application JavaScript parses',false,error.message); }
try{ new Function(read('qualtrics/insights.js')); check('Qualtrics insights module parses',true); }catch(error){ check('Qualtrics insights module parses',false,error.message); }
try{ const scripts=[...generator.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(source=>source.trim()); scripts.forEach(source=>new Function(source)); check('Qualtrics generator inline JavaScript parses',true,`${scripts.length} script(s)`); }catch(error){ check('Qualtrics generator inline JavaScript parses',false,error.message); }
try{ new Function(read('tests/regression-tests.js')); check('regression JavaScript parses',true); }catch(error){ check('regression JavaScript parses',false,error.message); }
if(failed) process.exit(1);
