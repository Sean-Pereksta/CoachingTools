/* Organization loader plus a hard manual-only gate for All-Star categorization.
 * The organization implementation is kept in organizations-core.js so this guard
 * can run after imports.js is defined and before app.js wires any buttons/startup.
 */
'use strict';

document.write('<script src="js/organizations-core.js"><\/script>');

(function installManualCategorizationGate(){
  if(typeof categorizeImportedData!=='function'){
    console.error('[All-Star] Manual categorization gate could not find categorizeImportedData.');
    return;
  }

  const nativeCategorizeImportedData=categorizeImportedData;
  const nativeRenderCategorizedSummary=typeof renderCategorizedSummary==='function'?renderCategorizedSummary:null;
  const nativePackageImportedData=typeof packageImportedData==='function'?packageImportedData:null;
  const nativeImportCoachToolsBatch=typeof importCoachToolsBatch==='function'?importCoachToolsBatch:null;
  const nativeFinishSingleSourceIntake=typeof finishSingleSourceIntake==='function'?finishSingleSourceIntake:null;
  const nativeSetAllStarStartupPhase=typeof setAllStarStartupPhase==='function'?setAllStarStartupPhase:null;
  let manualCategorizationPromise=null;

  state.categorizationManualOnly=true;

  function categorizeButton(){ return typeof els!=='undefined'?els.categorizeDataBtn:null; }
  function isDirectCategorizeClick(request){
    const button=categorizeButton();
    return !!button && !!request && request.type==='click' && request.currentTarget===button && request.isTrusted===true;
  }
  function categorizedCounts(){
    return {
      nondated:Number(state?.categorized?.nondated?.rows?.length||0),
      dated:Number(state?.categorized?.dated?.rows?.length||0)
    };
  }
  function markCategorizationPending(reason='source data changed'){
    state.categorizationPending=true;
    state.categorizationPendingReason=String(reason||'source data changed');
    if(nativeRenderCategorizedSummary) renderCategorizedSummary();
  }
  function clearCategorizationPending(){
    state.categorizationPending=false;
    state.categorizationPendingReason='';
  }
  function restoreCategorizedSnapshot(snapshot){
    if(!snapshot||!state?.categorized) return;
    state.categorized.nondated=snapshot.nondated;
    state.categorized.dated=snapshot.dated;
    state.categorized.warnings=snapshot.warnings;
  }
  function sourceAffectsCategorization(source){
    if(!source) return false;
    if(typeof QA_DIRECT_SOURCE!=='undefined' && source===QA_DIRECT_SOURCE) return false;
    if(typeof NONDATED_SOURCE!=='undefined' && source===NONDATED_SOURCE) return false;
    if(typeof DATED_SOURCE!=='undefined' && source===DATED_SOURCE) return false;
    if(typeof TEAM_TOTAL_SOURCE_KEYS!=='undefined' && TEAM_TOTAL_SOURCE_KEYS.includes(source)) return false;
    return true;
  }

  if(nativeRenderCategorizedSummary){
    renderCategorizedSummary=function(){
      nativeRenderCategorizedSummary();
      if(!state.categorizationPending || !els?.categorizedDataSummary) return;
      const counts=categorizedCounts();
      const hasPrevious=counts.nondated>0 || counts.dated>0;
      els.categorizedDataSummary.textContent=hasPrevious
        ? `Categorization pending — the last manual categorized database remains loaded (${counts.nondated.toLocaleString()} non-date reps, ${counts.dated.toLocaleString()} dated rows), but source data changed afterward. Nothing has been re-categorized. Press Categorize Data when you are ready.`
        : 'Categorization pending — source data is loaded, but categorization has NOT run. Press Categorize Data when you are ready.';
    };
  }

  categorizeImportedData=async function(request={}){
    if(!isDirectCategorizeClick(request)){
      const reason=request?.reason || (request?.automatic?'automatic categorization request':'non-button categorization request');
      markCategorizationPending(reason);
      console.info('[All-Star] Categorization blocked because Categorize Data was not explicitly clicked.',reason);
      // Existing startup/import callers treat false as a fatal rebuild failure. Returning
      // true means "request handled" while intentionally leaving categorized data untouched.
      return true;
    }

    if(state.coachToolsBatchImportRunning){
      alert('The import is still being applied. Finish the import first, then click Categorize Data so the categorization can run once against the completed source data.');
      return false;
    }
    if(manualCategorizationPromise) return manualCategorizationPromise;

    const button=categorizeButton();
    const priorLabel=button?.textContent||'Categorize Data';
    const snapshot={
      nondated:state.categorized?.nondated,
      dated:state.categorized?.dated,
      warnings:state.categorized?.warnings
    };

    if(button){
      button.disabled=true;
      button.textContent='Categorizing…';
      button.setAttribute('aria-busy','true');
    }

    manualCategorizationPromise=(async()=>{
      try{
        const completed=await nativeCategorizeImportedData({
          automatic:false,
          reason:'Categorize Data button',
          manageProgress:true,
          render:true,
          persist:true
        });
        if(!completed){
          restoreCategorizedSnapshot(snapshot);
          markCategorizationPending('manual categorization did not complete');
          if(nativeRenderCategorizedSummary) renderCategorizedSummary();
          return false;
        }
        clearCategorizationPending();
        if(nativeRenderCategorizedSummary) renderCategorizedSummary();
        return true;
      }catch(error){
        restoreCategorizedSnapshot(snapshot);
        markCategorizationPending('manual categorization failed');
        if(nativeRenderCategorizedSummary) renderCategorizedSummary();
        console.error('[All-Star] Manual categorization failed and the previous categorized state was restored.',error);
        alert('Categorization did not complete. The previous categorized database was restored; no partial categorization was kept.');
        return false;
      }finally{
        manualCategorizationPromise=null;
        if(button){
          button.disabled=false;
          button.textContent=priorLabel;
          button.removeAttribute('aria-busy');
        }
      }
    })();

    return manualCategorizationPromise;
  };

  if(nativeFinishSingleSourceIntake){
    finishSingleSourceIntake=async function(source,...args){
      const result=await nativeFinishSingleSourceIntake(source,...args);
      if(sourceAffectsCategorization(source)) markCategorizationPending(`${typeof labelSource==='function'?labelSource(source):source} source data updated`);
      return result;
    };
  }

  if(nativePackageImportedData){
    packageImportedData=async function(...args){
      const counts=categorizedCounts();
      if(state.categorizationPending || (!counts.nondated && !counts.dated)){
        alert('Package creation will not run categorization automatically. Click Categorize Data first, let it finish, then package the imported data.');
        return false;
      }
      return nativePackageImportedData(...args);
    };
  }

  if(nativeImportCoachToolsBatch){
    importCoachToolsBatch=async function(...args){
      const result=await nativeImportCoachToolsBatch(...args);
      if(state.categorizationPending && els?.coachtoolsImportSummary){
        els.coachtoolsImportSummary.textContent=els.coachtoolsImportSummary.textContent
          .replace(/ · Dated and Non-Date databases rebuilt/g,'')
          .replace(/\.$/,'') + ' · Categorization unchanged — press Categorize Data when ready.';
      }
      if(nativeRenderCategorizedSummary) renderCategorizedSummary();
      return result;
    };
  }

  if(nativeSetAllStarStartupPhase){
    setAllStarStartupPhase=function(job,start,end,message,...args){
      const next=/categorized data/i.test(String(message||''))
        ? 'Source data refreshed — categorization left unchanged until you press Categorize Data.'
        : message;
      return nativeSetAllStarStartupPhase(job,start,end,next,...args);
    };
  }

  const button=categorizeButton();
  if(button){
    button.title='Categorization only runs when you explicitly press this button.';
    const help=button.parentElement?.querySelector('.checkResultMeta');
    if(help) help.textContent='Imports and shared data refreshes update source data only. Categorization never runs automatically. Press Categorize Data when you want to rebuild the Non-Date and Dated databases.';
  }
})();
