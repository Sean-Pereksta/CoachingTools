/* Shared monthly review used by All-Star, Clean Upload and Update Data. */
(function(root){
  'use strict';
  const M=root.CoachToolsMonthly;
  async function read(file){
    if(/\.xlsx?$/i.test(file.name)){const wb=root.XLSX.read(await file.arrayBuffer(),{type:'array',raw:true});for(const sn of wb.SheetNames){const rows=root.XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:false});if(M.detect(rows))return M.source(rows,file.name);}throw new Error('No monthly export headers found in this workbook.');}
    return M.source(M.delimited(M.decode(await file.arrayBuffer())),file.name);
  }
  function element(tag,text){const e=root.document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function button(text,fn){const e=element('button',text);e.type='button';e.onclick=fn;return e;}
  function field(label,input){const e=element('label');e.append(element('span',label+' '),input);e.style.cssText='max-width:100%;display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin:5px';return e;}
  function select(options,value,change){const e=element('select');e.style.maxWidth='100%';for(const [v,t] of options){const o=element('option',t);o.value=v;e.append(o);}e.value=value||'';e.onchange=()=>change(e.value);return e;}
  function input(type,value,change){const e=element('input');e.style.maxWidth='100%';e.type=type;if(type==='checkbox')e.checked=!!value;else e.value=value||'';e.onchange=()=>change(type==='checkbox'?e.checked:e.value);return e;}
  function table(headers,rows){const wrap=element('div');wrap.style.cssText='overflow:auto;max-height:320px;max-width:100%;border:1px solid #ddd;margin:8px 0';const t=element('table');t.style.cssText='border-collapse:collapse;width:100%;font-size:13px';const head=element('tr');headers.forEach(h=>head.append(element('th',h)));t.append(head);for(const row of rows){const tr=element('tr');for(const v of row){const td=element('td');td.style.cssText='padding:6px;border-bottom:1px solid #ddd;vertical-align:top';if(v&&typeof v==='object'&&v.nodeType)td.append(v);else td.textContent=String(v??'N/A');tr.append(td);}t.append(tr);}wrap.append(t);return wrap;}
  function details(label,content,open=false){const d=element('details');d.open=open;d.append(element('summary',label),content);d.style.margin='10px 0';return d;}
  const count=c=>c?.value===null?`${c.status} (${c.raw||'blank'})`:c?.value??'N/A';
  const ratio=g=>`${g.appointments??g.accepted??'N/A'} / ${g.opportunities??g.offered??'N/A'} · ${g.rate===null?'N/A':(g.rate*100).toFixed(1)+'%'} · ${g.status||'partial'}`;
  let reviewOpen=false;
  async function review(options={}){
    if(reviewOpen)throw new Error('Finish the current monthly review first.');
    let b=M.clone(options.bundle||M.create(options.scope||'mixed')),prior=M.clone(options.bundle||M.create(b.scope));
    let notice='',query='';
    for(const src of options.sources||[]){const added=M.add(b,src);b=added.bundle;if(added.duplicate)notice='Duplicate file ignored; totals are unchanged.';}
    const overlay=element('div');overlay.style.cssText='position:fixed;inset:0;background:#0009;z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px';
    const dialog=element('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Monthly import review');dialog.style.cssText='background:white;color:#18202b;width:min(1100px,96vw);max-height:94vh;overflow:auto;padding:20px;border-radius:12px;box-shadow:0 12px 60px #0008';overlay.append(dialog);
    const previousFocus=root.document.activeElement;root.document.body.append(overlay);reviewOpen=true;
    return new Promise(resolve=>{
      const close=value=>{reviewOpen=false;overlay.remove();previousFocus?.focus?.();resolve(value);};
      const change=fn=>{fn();b.partialAcknowledged=false;render();};
      const render=()=>{
        const scroll=dialog.scrollTop, out=M.compile(b);dialog.replaceChildren();
        dialog.append(element('h2',options.readOnly?'Monthly Data Settings':'Monthly import review'));
        dialog.append(element('p',notice||'One Opportunity file establishes the roster. Add any number of Wiper files, then review the reporting periods and matches.'));
        const controls=element('div');
        if(!options.readOnly){
          controls.append(field('Monthly area',select([['retail','Monthly Retail'],['referral','Monthly Referral'],['mixed','Mixed — assign each coach']],b.scope,v=>change(()=>b.scope=v))));
          for(const [kind,label,multiple] of [['opportunity','Opportunity file',false],['wiper','Add Wiper files',true]]){
            const upload=input('file','',()=>{});upload.accept='.csv,.tsv,.xlsx,.xls';upload.multiple=multiple;
            upload.onchange=async()=>{const files=Array.from(upload.files||[]);try{let next=M.clone(b);for(const f of files){const src=await read(f);if(src.kind!==kind)throw new Error(`Choose a ${kind} export for this upload.`);const a=M.add(next,src);next=a.bundle;notice=a.duplicate?'Duplicate file ignored; counts unchanged.':'';}b=next;render();}catch(e){notice=e.message;render();}};
            controls.append(field(label,upload));
          }
        }
        if(!options.readOnly&&(options.existingBundles||[]).length>1)controls.append(field('Resume existing bundle',select([['','Select if adding to a saved area'],...options.existingBundles.map(e=>[e.area,`${e.area}: ${e.bundle.opportunity?.name||''}`])],'',v=>{if(!v)return;b=M.clone(options.existingBundles.find(e=>e.area===v).bundle);prior=M.clone(b);for(const src of options.sources||[])b=M.add(b,src).bundle;render();})));
        dialog.append(controls,element('p',`Opportunity: ${b.opportunity?.name||'not selected'} · Fiscal period: ${out.period?out.period.start+' through '+out.period.end:'needs review'}`));
        dialog.append(element('p',`${out.reps.length} representatives · ${out.teams.length} teams · ${out.matched} matched wiper records · ${out.issues.length} issues · ${out.partial?'Partial / incomplete results':'Complete coverage'}`));
        if(b.opportunity?.mappingRequired&&!options.readOnly){
          const src=b.opportunity,form=element('div'),map={coach:0,name:1,period:2,headerRows:3,columns:{}};
          const width=Math.max(...src.aoa.slice(0,5).map(r=>r.length));const cols=Array.from({length:width},(_,i)=>[String(i),`${i+1}: ${src.aoa.slice(0,3).map(r=>r[i]||'').join(' / ')}`]);
          for(const k of ['coach','name','period'])form.append(field(k,select(cols,String(map[k]),v=>map[k]=Number(v))));
          let offset=3;for(const s of M.SEGMENTS)for(const m of ['opportunities','appointments','rate']){const k=s+':'+m;map.columns[k]=offset++;form.append(field(k,select(cols,String(map.columns[k]),v=>map.columns[k]=Number(v))));}
          form.append(field('First data row',input('number',4,v=>map.headerRows=Number(v)-1)),button('Confirm column mapping',()=>{try{change(()=>b.opportunity=M.source(src.aoa,src.name,map));}catch(e){notice=e.message;render();}}));
          form.append(table(['Row','Cells'],src.aoa.slice(0,8).map((r,i)=>[i+1,r.join(' | ')])));dialog.append(details('Changed structure — mapping preview',form,true));
        }
        if(b.scope==='mixed'){
          const coaches=[...new Set((b.opportunity?.rows||[]).map(r=>r.coach).filter(Boolean))];
          dialog.append(details('Coach → monthly area mapping',table(['Coach','Area'],coaches.map(coach=>[coach,options.readOnly?b.coachAreas[M.key(coach)]||'Unassigned':select([['','Assign area'],['retail','Monthly Retail'],['referral','Monthly Referral']],b.coachAreas[M.key(coach)],v=>change(()=>b.coachAreas[M.key(coach)]=v))])),out.issues.some(i=>i.code==='area-required')));
        }
        const mappings=element('div');
        mappings.append(element('p','CONSUMER is preserved as Consumer. Cash aliases are available only after you verify these definitions match. Conversion, ITAC, revenue and hire dates are not provided by these exports.'));
        if(options.readOnly)mappings.append(element('p',`Consumer → Cash: ${b.consumerAsCash?'confirmed':'unmapped'} · Fully blank segments: ${b.blankSegments}`));
        else{
          mappings.append(field('I verified Consumer opportunities/appointments match our existing Cash definition',input('checkbox',b.consumerAsCash,v=>change(()=>b.consumerAsCash=v))));
          mappings.append(field('Fully blank segment groups',select([['missing','Missing / unknown (default)'],['no-activity','Verified export convention: no activity']],b.blankSegments,v=>change(()=>b.blankSegments=v))));
        }
        dialog.append(details('Source mappings and unavailable metrics',mappings));
        const files=element('div');
        for(const f of b.wipers){
          const body=element('div');body.append(element('strong',f.name),element('p',`${f.rows.length} source rows · ${f.id}`));
          if(!options.readOnly){body.append(button('Remove file',()=>change(()=>{b.wipers=b.wipers.filter(x=>x.id!==f.id);for(const x of b.wipers)if(x.replaces===f.id)delete x.replaces;})));
            body.append(field('Replaces corrected file',select([['','Adds a new reporting bucket'],...b.wipers.filter(x=>x.id!==f.id).map(x=>[x.id,x.name])],f.replaces,v=>change(()=>f.replaces=v))));}
          const replaced=b.wipers.some(x=>x.replaces===f.id);if(replaced){body.append(element('p','Replaced — excluded from totals.'));files.append(body);continue;}
          for(const label of new Set(f.rows.map(r=>r.reportDate||r.reportLabel))){
            const a=f.assignments[label]||{},line=element('div');line.style.cssText='border:1px solid #ddd;padding:8px;margin:8px 0';line.append(element('strong','REPORT DATE: '+(label||'(blank)')));
            const set=(k,v)=>change(()=>{f.assignments[label]={...a,[k]:v};});
            if(options.readOnly)line.append(element('p',a.exclude?'Excluded':`${a.start} — ${a.end} · ${a.meaning} · ${a.note}`));
            else{line.append(field('Exclude this report label',input('checkbox',a.exclude,v=>set('exclude',v))));
              if(!a.exclude)line.append(field('Meaning',select([['','Select'],['activity-date','Activity date'],['week-label','Week label'],['export-date','Export/report date']],a.meaning,v=>set('meaning',v))),field('Activity from',input('date',a.start,v=>set('start',v))),field('through',input('date',a.end,v=>set('end',v))),field('Basis for assignment',input('text',a.note,v=>set('note',v))));}
            body.append(line);
          }files.append(body);
        }
        dialog.append(details(`Wiper files and reporting buckets (${b.wipers.length})`,files,true));
        const diagnostic=element('div');
        const choicesList=element('datalist');choicesList.id='monthlyRepresentativeChoices';
        const choiceLabel=r=>`${r.name} — ${r.coach} (${r.area||'unassigned'}; row ${r.sourceRow})`;
        const choiceIds=new Map(out.reps.map(r=>[choiceLabel(r),r.id]));
        for(const label of choiceIds.keys()){const option=element('option');option.value=label;choicesList.append(option);}diagnostic.append(choicesList);
        const search=input('search',query,v=>{query=v;render();});search.placeholder='Filter by name, file or issue';diagnostic.append(field('Find issue',search));
        const filtered=out.issues.filter(i=>M.key(JSON.stringify(i)).includes(M.key(query))).sort((a,c)=>(c.severity==='blocker'?2:c.contributionId?1:0)-(a.severity==='blocker'?2:a.contributionId?1:0));
        diagnostic.append(table(['Issue','Source / row','Counts / action'],filtered.slice(0,200).map(i=>{
          const action=element('div');if(i.accepted)action.append(element('p',`Accepted: ${count(i.accepted)} · Offered: ${count(i.offered)}`));
          else if(i.counts)action.append(element('p',JSON.stringify(i.counts)));
          if(!options.readOnly&&i.contributionId){
            const saved=b.allocations[i.contributionId]||{},choices=i.candidates?.length?out.reps.filter(r=>i.candidates.includes(r.id)):out.reps;
            let target=saved.repId||'',reason=saved.reason||'';
            if(i.candidates?.length)action.append(select([['','Choose representative'],...choices.map(r=>[r.id,choiceLabel(r)])],target,v=>target=v));
            else {const choose=input('text','',v=>target=choiceIds.get(v)||'');choose.setAttribute('list','monthlyRepresentativeChoices');choose.placeholder='Search roster; select the exact person';action.append(choose);}
            const why=input('text',reason,v=>reason=v);why.placeholder='Different people, transfer allocation, or verified alias';action.append(why);
            action.append(button('Allocate',()=>{reason=why.value;if(!target||!reason.trim()){notice='Select the representative and document why.';render();return;}change(()=>b.allocations[i.contributionId]={repId:target,reason});}),button('Exclude with reason',()=>{reason=why.value;if(!reason.trim()){notice='Enter an exclusion reason.';render();return;}change(()=>b.allocations[i.contributionId]={exclude:true,reason});}));
          }
          return [`${i.severity}: ${i.name?i.name+' — ':''}${i.message}`,`${i.source||''}${i.row?' · row '+i.row:''}`,action];
        })));
        if(filtered.length>200)diagnostic.append(element('p',`Showing 200 of ${filtered.length}; use the filter to find remaining records.`));
        dialog.append(details('Matching exceptions, excluded counts and coverage issues',diagnostic));
        const repRows=out.reps.filter(r=>M.key(r.name+' '+r.coach).includes(M.key(query)));
        const drill=element('div');drill.append(element('p','Use the issue/name filter above to narrow representatives. Rates shown here are based on available valid counts; status identifies missing coverage.'));
        drill.append(table(['Representative','Coach / area','Commercial','Consumer','Insurance','Wipers / contributing files'],repRows.slice(0,150).map(r=>[r.name,`${r.coach} / ${r.area||'unassigned'}`,...M.SEGMENTS.map(s=>ratio(r.segments[s])),details(ratio(r.wiper),table(['File','Report label','Activity coverage','Accepted','Offered','Allocation'],r.wiper.contributions.map(c=>[c.file,c.reportDate,c.start+' — '+c.end,c.accepted,c.offered,c.allocation?.reason||'Exact unambiguous name'])))])));
        if(repRows.length>150)drill.append(element('p',`Showing 150 of ${repRows.length}; filter by name or coach above.`));
        dialog.append(details('Representative calculations and wiper drill-down',drill));
        dialog.append(details('Full team totals (all roster members)',table(['Coach','Area','Reps','Commercial','Consumer','Insurance','Wipers'],out.teams.map(t=>[t.coach,t.area,t.repCount,...M.SEGMENTS.map(s=>ratio(t.segments[s])),ratio(t.wiper)]))));
        const changes=element('div');changes.append(table(['Change','Representative','From','To'],M.changes(prior,b,options.previousRoster||[]).map(c=>[c.type,c.name,c.from,c.to])));
        const fileChanges=[];
        for(const f of b.wipers)if(!prior.wipers.some(p=>p.id===f.id))fileChanges.push([f.replaces?'Replacement':'Added',f.name,f.replaces?prior.wipers.find(p=>p.id===f.replaces)?.name||f.replaces:'New contribution']);
        for(const f of prior.wipers)if(!b.wipers.some(p=>p.id===f.id))fileChanges.push(['Removed',f.name,'Prior contribution will be removed']);
        changes.append(table(['File change','File','Effect'],fileChanges));
        dialog.append(details('Changes before applying',changes));
        if(!options.readOnly){
          dialog.append(field('I reviewed the issues and accept explicitly labeled partial results',input('checkbox',b.partialAcknowledged,v=>{b.partialAcknowledged=v;render();})));
          const apply=button('Apply monthly import',()=>close(M.clone(b)));apply.disabled=!out.canApply;dialog.append(apply);
        }
        dialog.append(button(options.readOnly?'Close':'Cancel — keep current data',()=>close(null)));
        dialog.scrollTop=scroll;
      };
      overlay.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close(null);}if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button,input,select,summary')].filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&root.document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&root.document.activeElement===last){e.preventDefault();first?.focus();}}};
      render();dialog.querySelector('select,button')?.focus();
    });
  }
  root.CoachToolsMonthlyReview={read,review};
})(typeof window!=='undefined'?window:globalThis);
