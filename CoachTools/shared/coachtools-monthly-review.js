/* Monthly exports: select files, inspect combined totals, and save. */
(function(root){
  'use strict';
  const M=root.CoachToolsMonthly;
  async function read(file){
    if(/\.xlsx?$/i.test(file.name)){const wb=root.XLSX.read(await file.arrayBuffer(),{type:'array',raw:true});for(const sn of wb.SheetNames){const rows=root.XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:false});if(M.detect(rows))return M.source(rows,file.name);}throw new Error('No monthly export headers found in this workbook.');}
    return M.source(M.delimited(M.decode(await file.arrayBuffer())),file.name);
  }
  function element(tag,text){const e=root.document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function button(text,fn){const e=element('button',text);e.type='button';e.onclick=fn;return e;}
  function field(label,input){const e=element('label');e.append(element('span',label+' '),input);e.style.cssText='display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin:5px;max-width:100%';return e;}
  function select(options,value,change){const e=element('select');e.style.maxWidth='100%';for(const [v,t] of options){const o=element('option',t);o.value=v;e.append(o);}e.value=value||'';e.onchange=()=>change(e.value);return e;}
  function input(type,value,change){const e=element('input');e.style.maxWidth='100%';e.type=type;if(type==='checkbox')e.checked=!!value;else e.value=value||'';e.onchange=()=>change(type==='checkbox'?e.checked:e.value);return e;}
  function table(headers,rows){const wrap=element('div');wrap.style.cssText='overflow:auto;max-height:360px;max-width:100%;border:1px solid #ddd;margin:8px 0';const t=element('table');t.style.cssText='border-collapse:collapse;width:100%;font-size:13px';const head=element('tr');headers.forEach(h=>head.append(element('th',h)));t.append(head);for(const row of rows){const tr=element('tr');for(const v of row){const td=element('td');td.style.cssText='padding:8px;border-bottom:1px solid #ddd;vertical-align:top';if(v&&typeof v==='object'&&v.nodeType)td.append(v);else td.textContent=String(v??'N/A');tr.append(td);}t.append(tr);}wrap.append(t);return wrap;}
  function details(label,content,open=false){const d=element('details');d.open=open;d.append(element('summary',label),content);d.style.margin='12px 0';return d;}
  const count=c=>c?.value===null?`${c.status} (${c.raw||'blank'})`:c?.value??'N/A';
  const percent=n=>n===null||n===undefined?'N/A':(n*100).toFixed(2)+'%';
  const ratio=g=>`${g.appointments??g.accepted??'N/A'} / ${g.opportunities??g.offered??'N/A'} · ${percent(g.rate)}${g.status==='partial'||g.status==='missing'||g.status==='incomplete'?' · '+g.status:''}`;
  const loaded=value=>value?new Date(value).toLocaleString():'Not recorded';
  let reviewOpen=false;
  async function review(options={}){
    if(reviewOpen)throw new Error('Finish the current monthly upload first.');
    let b=M.clone(options.bundle||M.create(options.scope||'mixed')),prior=M.clone(b),managerFilter='',areaFilter='all',coachFilter='',query='',notice='',busy=false,closed=false;
    if(!options.readOnly)b=M.asUndated(b);
    const ordered=sources=>[...sources].sort((a,c)=>(a.kind==='opportunity'?0:1)-(c.kind==='opportunity'?0:1));
    const addSources=(bundle,sources)=>{let next=M.clone(bundle),duplicates=0;for(const src of ordered(sources)){const added=M.add(next,src);next=added.bundle;if(added.duplicate)duplicates++;}notice=duplicates?`${duplicates} duplicate file(s) ignored; totals are unchanged.`:'';return next;};
    const initialSources=options.sources||[];b=addSources(b,initialSources);
    const overlay=element('div');overlay.id='monthlyImportReview';overlay.style.cssText='position:fixed;inset:0;background:#0009;z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px';
    const dialog=element('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Monthly import review');dialog.style.cssText='background:white;color:#18202b;width:min(1200px,96vw);max-height:94vh;overflow:auto;padding:20px;border-radius:12px;box-shadow:0 12px 60px #0008';overlay.append(dialog);
    const body=element('div');dialog.append(body);
    const previousFocus=root.document.activeElement;root.document.body.append(overlay);reviewOpen=true;
    return new Promise((resolve,reject)=>{
      const close=value=>{if(busy)return;closed=true;reviewOpen=false;overlay.remove();if(previousFocus?.isConnected)previousFocus.focus?.();resolve(value);};
      const change=fn=>{if(busy)return;fn();render();};
      const save=async()=>{
        if(busy||!M.compile(b).canApply)return;
        const bundle={...M.clone(b),importedAt:new Date().toISOString()};
        busy=true;notice='Saving combined monthly data…';render();
        try{
          if(options.onApply&&(await options.onApply(bundle))===false)throw new Error('The data could not be saved. Your selected files are still here; please retry.');
          busy=false;close(bundle);
        }catch(error){busy=false;notice='Could not save: '+(error?.message||String(error));render();dialog.querySelector('[role="status"]')?.scrollIntoView?.({block:'nearest'});}
      };
      // Keep the Save button mounted when a file, search, or assignment changes.
      // A blur/change event must not remove the button before its click fires.
      const actions=element('div');actions.style.cssText='position:sticky;bottom:-20px;background:white;border-top:1px solid #ddd;padding:12px 0;z-index:1';
      const apply=options.readOnly?null:button('Save monthly data',save),cancel=button(options.readOnly?'Close':'Cancel',()=>close(null));
      if(apply){apply.id='monthlyApply';actions.append(apply);}actions.append(cancel);dialog.append(actions);
      const render=()=>{
        if(closed)return;
        const scroll=dialog.scrollTop,out=M.compile(b);body.replaceChildren();
        body.append(element('h2',options.readOnly?'Monthly Data Settings':'Upload monthly exports'));
        body.append(element('p','Choose one Opportunity file and all of its Wiper files. Teams are identified automatically, and Wiper counts are added to the same data preview. Original Opportunity period and Wiper report labels remain separate for coverage review.'));
        const status=element('p',notice);status.setAttribute('role','status');status.setAttribute('aria-live','polite');body.append(status);
        if(!options.readOnly){
          const upload=input('file','',()=>{});upload.id='monthlyFiles';upload.accept='.csv,.tsv,.xlsx,.xls';upload.multiple=true;upload.dataset.coachtoolsAutoImport='false';
          upload.onchange=async()=>{
            if(busy)return;const files=Array.from(upload.files||[]);if(!files.length)return;
            busy=true;notice=`Reading ${files.length} file(s)…`;render();
            try{const sources=[];for(const file of files)sources.push(await read(file));if(sources.filter(s=>s.kind==='opportunity').length>1)throw new Error('Choose one Opportunity file per upload, plus any number of Wiper files.');b=addSources(b,sources);}
            catch(error){notice=error?.message||String(error);}finally{busy=false;render();}
          };
          body.append(field('Add Opportunity / Wiper files',upload));
          if((options.existingBundles||[]).length>1)body.append(field('Add to saved data',select([['','New upload'],...options.existingBundles.map(e=>[e.area,`${e.area}: ${e.bundle.opportunity?.name||''}`])],'',v=>{if(!v)return;change(()=>{prior=M.clone(options.existingBundles.find(e=>e.area===v).bundle);b=addSources(M.asUndated(prior),initialSources);});})));
        }
        const files=element('div');
        files.append(table(['File','Type','Rows','Loaded',''],[...(b.opportunity?[b.opportunity]:[]),...b.wipers].map(f=>[f.name,f.kind==='opportunity'?'Opportunity / team roster':b.wipers.some(n=>!n.excluded&&n.replaces===f.id)?'Wipers — replaced':'Wipers',f.rows.length,loaded(f.importedAt),options.readOnly?'':button('Remove',()=>change(()=>{if(f.kind==='opportunity'){b.opportunity=null;b.allocations={};}else{b.wipers=b.wipers.filter(x=>x.id!==f.id);for(const x of b.wipers)if(x.replaces===f.id)delete x.replaces;}}))])));
        if(b.opportunity||b.wipers.length)body.append(files);
        body.append(element('p',`${out.reps.length} representatives · ${out.teams.length} teams · ${out.managers?.length||0} manager groups · ${out.matched} matched Wiper rows · ${b.wipers.filter(f=>!f.excluded&&!b.wipers.some(n=>!n.excluded&&n.replaces===f.id)).length} Wiper files combined`));
        body.append(element('p','Cash = Consumer opportunities ÷ (Consumer + Insurance + Commercial opportunities). 15% or higher → Retail; below 15% → Referral. Missing or zero opportunity totals → Unclassified / Needs Review. Consumer fields also supply Cash statistics.'));
        if(out.reps.length){
          const search=input('search',query,v=>{query=v;render();});search.id='monthlyPreviewSearch';search.placeholder='Representative or coach';body.append(field('Filter preview',search));
          const includes=value=>M.key(value).includes(M.key(query));
          if(out.managers){
            body.append(field('Manager',select([['','All managers'],...out.managers.map(m=>[m.manager,m.manager])],managerFilter,v=>change(()=>{managerFilter=v;coachFilter='';}))),field('Area',select([['all','All Teams'],['retail','Retail'],['referral','Referral'],['unclassified','Unclassified / Needs Review']],areaFilter,v=>change(()=>{areaFilter=v;coachFilter='';}))),field('Coach',select([['','All coaches'],...out.teams.filter(t=>(!managerFilter||(t.manager||'Unassigned Manager')===managerFilter)&&(areaFilter==='all'||t.area===areaFilter)).map(t=>[t.coach,t.coach])],coachFilter,v=>change(()=>coachFilter=v))));
            const scoped=M.compile(b,{manager:managerFilter,area:areaFilter,coach:coachFilter});
            body.append(element('h3','Manager totals'),table(['Manager','Coaches','Representatives','Total source','Consumer share',...M.SEGMENTS.map(s=>s+' apps / opps'),'Wipers accepted / offered','Missing Wiper reps'],scoped.managers.map(m=>[m.manager,m.coachCount,m.repCount,m.totalSource,percent(m.share),...M.SEGMENTS.map(s=>ratio(m.segments[s])),ratio(m.wiper),m.wiper.missingRepresentatives])));
            body.append(details('Source coverage',table(['Source','Original coverage label','Included'],[...out.sourcePeriods.map(p=>['Opportunity',p,'Yes']),...out.coverage.map(c=>[c.source,c.reportLabel||c.reportDate,c.included?'Yes':'No'])])));
          }
          const scopeMatch=r=>(!managerFilter||(r.manager||'Unassigned Manager')===managerFilter)&&(areaFilter==='all'||r.area===areaFilter)&&(!coachFilter||r.coach===coachFilter);
          const teams=out.teams.filter(t=>includes(t.coach)&&scopeMatch(t)), reps=out.reps.filter(r=>includes(r.name+' '+r.coach)&&scopeMatch(r));
          body.append(element('h3','Team totals preview'));
          const teamTable=table(['Coach','Manager','Total source','Area','Reps','Cash share','Commercial apps / opps','Consumer (Cash) apps / opps','Insurance apps / opps','Wipers accepted','Wipers offered','Wiper rate'],teams.map(t=>[t.coach,t.manager||'Unassigned Manager',t.totalSource||'Calculated total',t.area||'Unclassified / Needs Review',t.repCount,percent(out.coachAssignments.find(c=>c.key===M.key(t.coach))?.share),...M.SEGMENTS.map(s=>ratio(t.segments[s])),t.wiper.accepted,t.wiper.offered,percent(t.wiper.rate)]));teamTable.id='monthlyTeamPreview';body.append(teamTable);
          body.append(element('h3','Combined representative preview'));
          const repTable=table(['Representative','Coach','Manager','Area','Commercial apps / opps','Consumer (Cash) apps / opps','Insurance apps / opps','Wipers accepted','Wipers offered','Wiper rate'],reps.slice(0,150).map(r=>[r.name,r.coach,r.manager||'Unassigned Manager',r.area||'Unclassified / Needs Review',...M.SEGMENTS.map(s=>ratio(r.segments[s])),r.wiper.accepted,r.wiper.offered,percent(r.wiper.rate)]));repTable.id='monthlyRepPreview';body.append(repTable);
          if(reps.length>150)body.append(element('p',`Showing 150 of ${reps.length} representatives. Filter by name or coach to find others.`));
        }
        if(out.partial)body.append(element('p','Some records have missing data or could not be matched. Available valid counts are included; missing values remain N/A.'+(out.canApply?' You can save now and add or correct files later.':'')));
        const blockers=out.issues.filter(i=>i.severity==='blocker');
        if(blockers.length){const box=element('div');box.setAttribute('role','alert');box.append(element('strong','Before saving:'),...blockers.slice(0,10).map(i=>element('p',i.message)));body.append(box);}
        if(apply){apply.textContent=busy?'Working…':'Save monthly data';apply.disabled=busy||!out.canApply;}cancel.disabled=busy;
        const adjustments=element('div');
        if(!options.readOnly&&!out.managers)adjustments.append(field('Monthly area',select([['mixed','Mixed — auto-assign coaches'],['retail','Monthly Retail'],['referral','Monthly Referral']],b.scope,v=>change(()=>b.scope=v))));
        if(b.scope==='mixed')adjustments.append(table(['Coach','Cash / all opportunities','Cash share','Area'],out.coachAssignments.map(c=>[c.coach,c.complete?`${c.cash} / ${c.total}`:'Incomplete counts',percent(c.share),options.readOnly?c.area||'Unassigned':select([['',c.automatic?`Automatic — ${c.automatic==='retail'?'Monthly Retail':'Monthly Referral'}`:'Choose area'],['retail','Monthly Retail (manual)'],['referral','Monthly Referral (manual)']],c.override,v=>change(()=>{if(v)b.coachAreas[c.key]=v;else delete b.coachAreas[c.key];}))])));
        if(!options.readOnly)adjustments.append(field('Fully blank segment groups',select([['missing','Missing / unknown'],['no-activity','No activity in this export']],b.blankSegments,v=>change(()=>b.blankSegments=v))));
        for(const f of b.wipers){
          const body=element('div');body.append(element('strong',f.name));
          if(!options.readOnly)body.append(field('Corrects an earlier file',select([['','Adds counts'],...b.wipers.filter(x=>x.id!==f.id).map(x=>[x.id,x.name])],f.replaces,v=>change(()=>f.replaces=v))));
          let n=0;for(const label of new Set(f.rows.map(r=>r.reportDate||r.reportLabel))){const a=f.assignments?.[label]||{};body.append(field(`Source group ${++n} · ${f.rows.find(r=>(r.reportDate||r.reportLabel)===label)?.reportLabel||label||'(blank label)'}`,options.readOnly?element('span',a.exclude?'Excluded':'Included'):select([['include','Include'],['exclude','Exclude']],a.exclude?'exclude':'include',v=>change(()=>{f.assignments=f.assignments||{};f.assignments[label]={...a,exclude:v==='exclude'};}))));}
          adjustments.append(body);
        }
        body.append(details('Optional team assignments and file corrections',adjustments,blockers.some(i=>i.code==='area-required')));
        if(b.opportunity?.mappingRequired&&!options.readOnly){
          const src=b.opportunity,form=element('div'),map={coach:0,name:1,period:2,headerRows:3,columns:{}};
          const width=Math.max(...src.aoa.slice(0,5).map(r=>r.length)),cols=Array.from({length:width},(_,i)=>[String(i),`${i+1}: ${src.aoa.slice(0,3).map(r=>r[i]||'').join(' / ')}`]);
          for(const k of ['coach','name','period'])form.append(field(k==='period'?'Unused export label column':k,select(cols,String(map[k]),v=>map[k]=Number(v))));
          let offset=3;for(const s of M.SEGMENTS)for(const m of ['opportunities','appointments','rate']){const k=s+':'+m;map.columns[k]=offset++;form.append(field(k,select(cols,String(map.columns[k]),v=>map.columns[k]=Number(v))));}
          form.append(field('First data row',input('number',4,v=>map.headerRows=Number(v)-1)),button('Use column mapping',()=>{try{change(()=>b.opportunity=M.source(src.aoa,src.name,map));}catch(e){notice=e.message;render();}}));
          form.append(table(['Row','Cells'],src.aoa.slice(0,8).map((r,i)=>[i+1,r.join(' | ')])));body.append(details('Changed file structure — map columns',form,true));
        }
        if(out.issues.length){
          const diagnostic=element('div'),choices=element('datalist');choices.id='monthlyRepresentativeChoices';const choiceLabel=r=>`${r.name} — ${r.coach} (${r.area||'unassigned'}; row ${r.sourceRow})`,choiceIds=new Map(out.reps.map(r=>[choiceLabel(r),r.id]));
          for(const label of choiceIds.keys()){const option=element('option');option.value=label;choices.append(option);}diagnostic.append(choices);
          const issues=out.issues.filter(i=>M.key(JSON.stringify(i)).includes(M.key(query))).sort((a,c)=>Number(c.severity==='blocker')-Number(a.severity==='blocker'));
          diagnostic.append(table(['Record / issue','Source / row','Counts / optional correction'],issues.slice(0,200).map(i=>{
            const action=element('div');if(i.exported!==undefined)action.append(element('p',`Exported: ${i.exported} · Calculated detail: ${i.calculated}`));if(i.accepted)action.append(element('p',`Accepted: ${count(i.accepted)} · Offered: ${count(i.offered)}`));
            if(!options.readOnly&&i.contributionId){
              let target=b.allocations[i.contributionId]?.repId||'';
              const choose=input('text','',v=>target=choiceIds.get(v)||'');choose.setAttribute('list',choices.id);choose.placeholder='Choose representative';action.append(choose,button('Assign',()=>{if(!target){notice='Choose a representative from the list.';render();return;}change(()=>b.allocations[i.contributionId]={repId:target,reason:'Assigned in monthly import preview'});}),button('Exclude row',()=>change(()=>b.allocations[i.contributionId]={exclude:true,reason:'Excluded in monthly import preview'})));
            }
            return [i.name?i.name+' — '+i.message:i.message,`${i.source||''}${i.row?' · row '+i.row:''}`,action];
          })));
          if(issues.length>200)diagnostic.append(element('p',`Showing 200 of ${issues.length} issues. Filter the preview to narrow the list.`));
          body.append(details(`Missing or unmatched data (${out.issues.length})`,diagnostic,blockers.some(i=>i.contributionId)));
        }
        const lineage=element('div');lineage.append(element('p','Wiper counts stay with the coach supplied by Wiper. Manager mapping comes from Opportunity. Unmatched and unattributed activity is retained. Rates use these summed counts.'));
        lineage.append(table(['Representative','Coach','File','Row','Accepted','Offered'],out.reps.filter(r=>M.key(r.name+' '+r.coach).includes(M.key(query))).slice(0,150).flatMap(r=>r.wiper.contributions.map(c=>[r.name,r.coach,c.file,c.row,c.accepted,c.offered]))));
        body.append(details('Contributing Wiper rows',lineage));
        body.append(details('Roster changes',table(['Change','Representative','From','To'],M.changes(prior,b,options.previousRoster||[]).map(c=>[c.type,c.name,c.from,c.to]))));
        if(options.readOnly)body.append(element('p',`Loaded ${loaded(b.importedAt)}`));
        if(busy)dialog.querySelectorAll('button,input,select').forEach(node=>node.disabled=true);
        dialog.scrollTop=scroll;
      };
      overlay.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close(null);}if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button,input,select,summary')].filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&root.document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&root.document.activeElement===last){e.preventDefault();first?.focus();}}};
      try{render();dialog.querySelector('input,button')?.focus();}catch(error){reviewOpen=false;overlay.remove();reject(error);}
    });
  }
  root.CoachToolsMonthlyReview={read,review};
})(typeof window!=='undefined'?window:globalThis);
