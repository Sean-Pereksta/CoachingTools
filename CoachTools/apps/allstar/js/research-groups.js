/* Named representative populations. Membership never changes coach assignments. */
'use strict';

const RESEARCH_GROUPS_STORAGE_KEY='allStarResearchGroups.v1';
const RESEARCH_GROUP_PAGE_SIZE=50;
const researchGroupsUi={index:null,review:[],reviewPage:0,availablePage:0,selectedPage:0,groupPage:0,groupSearch:'',repSearch:'',selectedSearch:'',running:false,job:0,groupId:'',status:'',initialized:false};
function researchGroupNameKey(value){ return normalizeResearchText(String(value||'').replace(/^\$/,'').trim()); }
function researchGroupRepKey(value){ return normalizeIdentityName(canonicalRepName(String(value||''))); }
function normalizeResearchGroup(group={}){
  const seen=new Set(),repNames=[];
  for(const raw of Array.isArray(group.repNames)?group.repNames:[]){ if(typeof raw!=='string') continue; const name=canonicalRepName(raw),key=researchGroupRepKey(name); if(key&&!seen.has(key)){seen.add(key);repNames.push(name);} }
  const now=new Date().toISOString();
  return {id:typeof group.id==='string'&&group.id.trim()?group.id.trim():id(),name:String(group.name||'New Research Group').trim()||'New Research Group',repNames:repNames.sort((a,b)=>a.localeCompare(b)),createdAt:typeof group.createdAt==='string'?group.createdAt:now,updatedAt:typeof group.updatedAt==='string'?group.updatedAt:now};
}
function loadResearchGroups(){
  try{ const raw=JSON.parse(localStorage.getItem(RESEARCH_GROUPS_STORAGE_KEY)||'[]'),groups=Array.isArray(raw)?raw:raw?.researchGroups; state.researchGroups=(Array.isArray(groups)?groups:[]).filter(g=>g&&typeof g==='object').map(normalizeResearchGroup); }
  catch(_){state.researchGroups=[];}
  if(!findResearchGroup(state.activeResearchGroupId)) state.activeResearchGroupId=state.researchGroups[0]?.id||'';
  return state.researchGroups;
}
function saveResearchGroups(){
  state.researchGroups=(state.researchGroups||[]).map(normalizeResearchGroup);
  let storageError=null;
  try{localStorage.setItem(RESEARCH_GROUPS_STORAGE_KEY,JSON.stringify(state.researchGroups));}
  catch(error){researchGroupsUi.status='These group changes could not be saved on this device. Export the groups to keep a copy.';storageError=error;}
  if(typeof selectiveResearchInvalidation==='function')selectiveResearchInvalidation({reason:'Research group membership changed',teams:true});
  if(typeof renderResearchPopulationEditor==='function')renderResearchPopulationEditor();
  if(storageError)throw storageError;
  return state.researchGroups;
}
function findResearchGroup(ref){const raw=String(ref?.id||ref||'').replace(/^\$/,'').trim(),key=researchGroupNameKey(raw);return (state.researchGroups||[]).find(g=>g.id===raw)||(state.researchGroups||[]).find(g=>researchGroupNameKey(g.name)===key);}
function researchGroupRepSet(ref){const group=ref&&typeof ref==='object'?ref:findResearchGroup(ref);return new Set((group?.repNames||[]).map(researchGroupRepKey).filter(Boolean));}
function activeResearchGroup(){return findResearchGroup(state.activeResearchGroupId);}
function parseResearchGroupNames(value){
  const names=[],seen=new Set();
  // Commas, new lines, and spreadsheet cell separators are always delimiters.
  for(const part of String(value||'').replace(/\u00a0/g,' ').split(/[,\r\n\t;]+/)){
    const name=part.trim().replace(/^[\s•·▪◦*]+/,'').replace(/^\d+[.)]\s*/,'').replace(/^["']|["']$/g,'').trim(),key=fullNameIdentityKey(name);
    if(key&&!seen.has(key)){seen.add(key);names.push(name);}
  }
  return names;
}
function researchGroupRepIndexSignature(){return dataIndexSignature()+'|'+(state.versions?.mappings||0);}
function buildResearchGroupRepIndex(){
  const byKey=new Map();
  const add=(raw,coach)=>{const name=canonicalRepName(raw),key=researchGroupRepKey(name);if(!key)return;let entry=byKey.get(key);if(!entry){entry={key,name,coaches:[],compact:fullNameIdentityKey(name).replace(/[^a-z0-9]/g,''),tokens:fullNameIdentityKey(name).split(' ').filter(Boolean)};byKey.set(key,entry);}const team=canonicalCoachName(coach);if(team&&!entry.coaches.some(c=>coachNameKey(c)===coachNameKey(team)))entry.coaches.push(team);};
  for(const rep of currentTeamIndex().reps||[])add(rep.name,rep.team);
  for(const rep of controlRosterRows())add(rep._rep||rep.displayName||rep.representative,rep._team||rep.team);
  if(typeof researchPopulationChoices==='function')for(const rep of researchPopulationChoices().reps||[])add(rep.name,rep.team);
  // Raw weekly Names may not yet have an analytical index. Only this explicitly
  // opened manager scans them; rendering the Research editor stays metadata-only.
  for(const source of ['weeklyRetail','weeklyReferral'])for(const row of getRowsRaw(source)||[]){const person=weeklySourceRowIdentity(row,source);if(person.validRep)add(person.repName,person.coach);}
  const entries=[...byKey.values()].sort((a,b)=>a.name.localeCompare(b.name));
  return {entries,byKey,signature:researchGroupRepIndexSignature()};
}
function currentResearchGroupRepIndex(){if(researchGroupsUi.index?.signature!==researchGroupRepIndexSignature())researchGroupsUi.index=buildResearchGroupRepIndex();return researchGroupsUi.index;}
function researchGroupNameSimilarity(input,candidate){
  const q=fullNameIdentityKey(input).replace(/[^a-z0-9]/g,''),e=candidate.compact;
  if(!q||!e)return 0;if(q===e)return .99;
  // Skip edit distance where even the length difference cannot yield a useful suggestion.
  if(Math.min(q.length,e.length)/Math.max(q.length,e.length)<.55)return 0;
  let previous=Array.from({length:e.length+1},(_,i)=>i),current=new Array(e.length+1);
  for(let i=1;i<=q.length;i++){current[0]=i;for(let j=1;j<=e.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(q[i-1]===e[j-1]?0:1));[previous,current]=[current,previous];}
  const tokens=fullNameIdentityKey(input).split(' ').filter(Boolean),a=new Set(tokens),b=new Set(candidate.tokens),intersection=[...a].filter(t=>b.has(t)).length,union=new Set([...a,...b]).size;
  const tokenScore=union?intersection/union:0;
  return Math.max(1-previous[e.length]/Math.max(q.length,e.length),tokenScore*.96);
}
function researchGroupYield(){return new Promise(resolve=>setTimeout(resolve,0));}
async function matchResearchGroupNames(names,index,options={}){
  const results=[],total=names.length;let work=0,lastYield=Date.now();
  const check=()=>{if(options.cancelled?.()){const error=new Error('Name matching cancelled');error.name='AbortError';throw error;}};
  options.onProgress?.(0,total);await researchGroupYield();
  for(let position=0;position<total;position++){
    check();const input=names[position],exact=index.byKey.get(researchGroupRepKey(input));
    if(exact)results.push({input,status:'exact',matchName:exact.name,approved:true,skipped:false,candidates:[{...exact,score:1}]});
    else{
      const candidates=[];
      for(const entry of index.entries){
        const score=researchGroupNameSimilarity(input,entry);
        if(score>=.55){candidates.push({...entry,score});candidates.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));if(candidates.length>5)candidates.pop();}
        if(++work%200===0&&Date.now()-lastYield>=8){options.onProgress?.(position,total);await researchGroupYield();lastYield=Date.now();check();}
      }
      const best=candidates[0],ambiguous=best&&candidates[1]&&best.score-candidates[1].score<.04;
      results.push({input,status:best?.score>=.76?(ambiguous?'ambiguous':'suggested'):'unmatched',matchName:best?.name||'',approved:false,skipped:false,candidates});
    }
    if(position%25===0||Date.now()-lastYield>=8){options.onProgress?.(position+1,total);await researchGroupYield();lastYield=Date.now();}
  }
  check();options.onProgress?.(total,total);return results;
}
function researchGroupNode(id){return document.getElementById(id);}
function researchGroupStatus(message){researchGroupsUi.status=message;const node=researchGroupNode('researchGroupStatus');if(node)node.textContent=message;}
function researchGroupSaveAndRender(){try{saveResearchGroups();renderResearchGroups();return true;}catch(error){renderResearchGroups();return false;}}
function researchGroupResetReview(){researchGroupsUi.job++;researchGroupsUi.running=false;researchGroupsUi.review=[];researchGroupsUi.reviewPage=0;researchGroupsUi.groupId='';const input=researchGroupNode('researchGroupPasteInput');if(input)input.value='';renderResearchGroupReview();}
function openResearchGroupBuilder(){
  initResearchGroups();if(!state.researchGroups)loadResearchGroups();if(!activeResearchGroup()){researchGroupResetReview();state.activeResearchGroupId=state.researchGroups[0]?.id||'';}currentResearchGroupRepIndex();renderResearchGroups();openModal('researchGroupBuilderModal');
}
function createResearchGroup(){
  researchGroupResetReview();const existing=new Set((state.researchGroups||[]).map(g=>researchGroupNameKey(g.name)));let name='New Research Group',number=2;while(existing.has(researchGroupNameKey(name)))name='New Research Group '+number++;
  const group=normalizeResearchGroup({name});(state.researchGroups||=[]).push(group);state.activeResearchGroupId=group.id;researchGroupStatus('Group created. Search or paste representatives to add membership.');researchGroupSaveAndRender();researchGroupNode('researchGroupNameInput')?.focus();
}
function researchGroupPage(items,page){const pages=Math.max(1,Math.ceil(items.length/RESEARCH_GROUP_PAGE_SIZE)),current=Math.max(0,Math.min(page,pages-1));return {items:items.slice(current*RESEARCH_GROUP_PAGE_SIZE,(current+1)*RESEARCH_GROUP_PAGE_SIZE),page:current,pages,total:items.length};}
function researchGroupPager(id,page){const node=researchGroupNode(id);if(!node)return;node.innerHTML=`<button type="button" class="smallBtn" data-group-page="-1" ${page.page===0?'disabled':''}>Previous</button><span>Page ${page.page+1} of ${page.pages} · ${page.total.toLocaleString()} total</span><button type="button" class="smallBtn" data-group-page="1" ${page.page+1>=page.pages?'disabled':''}>Next</button>`;}
function renderResearchGroups(){
  const ui=researchGroupsUi,group=activeResearchGroup(),index=ui.index||{entries:[],byKey:new Map()},selected=researchGroupRepSet(group),groups=(state.researchGroups||[]).filter(g=>!ui.groupSearch||researchGroupNameKey(g.name).includes(researchGroupNameKey(ui.groupSearch))),groupPage=researchGroupPage(groups,ui.groupPage);ui.groupPage=groupPage.page;
  const list=researchGroupNode('researchGroupList');if(list)list.innerHTML=groupPage.items.map(g=>`<button type="button" class="teamManagerItem researchGroupCard ${g.id===group?.id?'active':''}" data-research-group-id="${esc(g.id)}" aria-pressed="${g.id===group?.id}"><strong>${esc(g.name)}</strong><span>${g.repNames.length.toLocaleString()} representatives</span></button>`).join('')||'<div class="hint">No groups found. Create a research group to start.</div>';
  researchGroupPager('researchGroupListPager',groupPage);
  const name=researchGroupNode('researchGroupNameInput');if(name)name.value=group?.name||'';
  const title=researchGroupNode('researchGroupActiveName');if(title)title.textContent=group?.name||'No group selected';
  const count=researchGroupNode('researchGroupCount');if(count)count.textContent=`${selected.size.toLocaleString()} representatives selected`;
  const available=index.entries.filter(r=>!ui.repSearch||researchGroupNameKey(r.name+' '+r.coaches.join(' ')).includes(researchGroupNameKey(ui.repSearch))),availablePage=researchGroupPage(available,ui.availablePage);ui.availablePage=availablePage.page;
  const availableNode=researchGroupNode('researchGroupRepList');if(availableNode)availableNode.innerHTML=availablePage.items.map(r=>`<label class="checkItem researchGroupRep"><input type="checkbox" data-research-group-rep="${esc(r.key)}" ${selected.has(r.key)?'checked':''} ${!group?'disabled':''}><span><strong>${esc(r.name)}</strong><small>${esc(r.coaches.join(' · ')||'No coach assigned')}</small></span></label>`).join('')||'<div class="hint">No representatives match. Import a roster or representative data first.</div>';
  researchGroupPager('researchGroupRepPager',availablePage);
  const members=(group?.repNames||[]).filter(n=>!ui.selectedSearch||researchGroupNameKey(n).includes(researchGroupNameKey(ui.selectedSearch))),selectedPage=researchGroupPage(members,ui.selectedPage);ui.selectedPage=selectedPage.page;
  const membersNode=researchGroupNode('researchGroupSelectedList');if(membersNode)membersNode.innerHTML=selectedPage.items.map(n=>{const entry=index.byKey.get(researchGroupRepKey(n));return `<div class="researchGroupMember"><span><strong>${esc(n)}</strong><small>${esc(entry?.coaches.join(' · ')||'Not in the current roster / data')}</small></span><button class="smallBtn red" type="button" data-research-group-remove="${esc(n)}" ${ui.running?'disabled':''}>Remove</button></div>`;}).join('')||'<div class="hint">No selected representatives match.</div>';
  researchGroupPager('researchGroupSelectedPager',selectedPage);
  for(const id of ['researchGroupNameInput','saveResearchGroupBtn','duplicateResearchGroupBtn','deleteResearchGroupBtn','clearResearchGroupBtn','researchGroupMatchBtn','researchGroupPasteInput']){const node=researchGroupNode(id);if(node)node.disabled=!group||ui.running;}
  for(const node of document.querySelectorAll('#researchGroupBuilderModal [data-research-group-id],#researchGroupBuilderModal [data-research-group-remove],#createResearchGroupBtn,#importResearchGroupsFile'))node.disabled=ui.running;
  for(const node of document.querySelectorAll('#researchGroupBuilderModal [data-research-group-rep]'))node.disabled=ui.running||!group;
  researchGroupStatus(ui.status);renderResearchGroupReview();
}
function renderResearchGroupReview(){
  const ui=researchGroupsUi,rows=ui.review,page=researchGroupPage(rows,ui.reviewPage);ui.reviewPage=page.page;
  const panel=researchGroupNode('researchGroupReviewPanel');if(panel)panel.classList.toggle('hidden',!rows.length&&!ui.running);
  const progress=researchGroupNode('researchGroupProgress');if(progress)progress.classList.toggle('hidden',!ui.running);
  const cancel=researchGroupNode('researchGroupCancelMatchBtn');if(cancel)cancel.classList.toggle('hidden',!ui.running);
  const approved=rows.filter(r=>r.approved&&!r.skipped).length,unresolved=rows.filter(r=>!r.approved&&!r.skipped).length;
  const summary=researchGroupNode('researchGroupReviewSummary');if(summary)summary.textContent=rows.length?`${rows.length.toLocaleString()} unique pasted names · ${approved.toLocaleString()} approved · ${unresolved.toLocaleString()} need review · ${rows.filter(r=>r.skipped).length.toLocaleString()} skipped`:'Matching names…';
  const body=researchGroupNode('researchGroupReviewRows');if(body)body.innerHTML=page.items.map((row,offset)=>{const i=page.page*RESEARCH_GROUP_PAGE_SIZE+offset,label={exact:'Exact name',suggested:'Suggested name — approve to use',ambiguous:'Several similar names — choose and approve',unmatched:'No confident match — search or skip'}[row.status];return `<tr><td>${esc(row.input)}<small class="researchGroupMatchStatus ${row.status}">${esc(label)}</small></td><td><input aria-label="Match for ${esc(row.input)}" data-research-group-match="${i}" list="researchGroupRepSuggestions" value="${esc(row.matchName)}" ${ui.running?'disabled':''}><small>${row.candidates.slice(0,3).map(c=>esc(c.name)+' ('+Math.round(c.score*100)+'%)').join(' · ')||'Search the imported representatives by name.'}</small></td><td><label class="researchGroupApproval"><input type="checkbox" data-research-group-approve="${i}" ${row.approved&&!row.skipped?'checked':''} ${row.skipped||ui.running?'disabled':''}>Approve</label><button class="smallBtn" type="button" data-research-group-skip="${i}" ${ui.running?'disabled':''}>${row.skipped?'Undo skip':'Skip'}</button></td></tr>`;}).join('');
  researchGroupPager('researchGroupReviewPager',page);
  const apply=researchGroupNode('researchGroupApplyMatchesBtn');if(apply){apply.disabled=ui.running||!approved||ui.groupId!==state.activeResearchGroupId;apply.textContent=`Add ${approved.toLocaleString()} approved representatives`;}
  const suggestions=researchGroupNode('researchGroupRepSuggestions');if(suggestions){const names=new Set(page.items.flatMap(r=>r.candidates.map(c=>c.name)));suggestions.innerHTML=[...names].map(n=>`<option value="${esc(n)}"></option>`).join('');}
}
async function previewResearchGroupPaste(){
  const ui=researchGroupsUi,group=activeResearchGroup();if(!group||ui.running)return;
  const names=parseResearchGroupNames(researchGroupNode('researchGroupPasteInput')?.value);if(!names.length)return researchGroupStatus('Paste one or more names separated by commas or line breaks.');
  const job=++ui.job;ui.running=true;ui.review=[];ui.reviewPage=0;ui.groupId=group.id;researchGroupStatus('Matching pasted names. Nothing is added until you approve the matches.');renderResearchGroups();
  const bar=researchGroupNode('researchGroupProgressBar'),label=researchGroupNode('researchGroupProgressLabel');
  const onProgress=(done,total)=>{if(bar){bar.max=total||1;bar.value=done;}if(label)label.textContent=`${done.toLocaleString()} of ${total.toLocaleString()} names checked (${total?Math.round(done/total*100):0}%)`;};onProgress(0,names.length);
  try{await researchGroupYield();if(job!==ui.job)return;currentResearchGroupRepIndex();ui.review=await matchResearchGroupNames(names,ui.index,{cancelled:()=>job!==ui.job,onProgress});if(job===ui.job)researchGroupStatus('Review the matches below. Exact names are selected; similar names require your approval. Only approved names are added.');}
  catch(error){if(error.name!=='AbortError')researchGroupStatus('Name matching could not finish: '+error.message);}
  finally{if(job===ui.job){ui.running=false;renderResearchGroups();}}
}
function applyResearchGroupMatches(){
  const ui=researchGroupsUi,group=activeResearchGroup();if(!group||ui.running||ui.groupId!==group.id)return;
  const approved=ui.review.filter(row=>row.approved&&!row.skipped),names=approved.map(row=>ui.index?.byKey.get(researchGroupRepKey(row.matchName))?.name).filter(Boolean),before=group.repNames.length;
  group.repNames=normalizeResearchGroup({...group,repNames:[...group.repNames,...names]}).repNames;group.updatedAt=new Date().toISOString();
  const remaining=ui.review.filter(row=>!row.approved&&!row.skipped).length;researchGroupStatus(`${(group.repNames.length-before).toLocaleString()} representatives added. ${remaining.toLocaleString()} unapproved names were left out. Coach assignments are preserved.`);researchGroupSaveAndRender();
}
function exportResearchGroups(){downloadText('all_star_research_groups.json',JSON.stringify({version:1,researchGroups:state.researchGroups||[]},null,2));}
function importResearchGroups(text){
  const raw=JSON.parse(text),incoming=Array.isArray(raw)?raw:raw?.researchGroups;
  if(!Array.isArray(incoming)||incoming.some(g=>!g||typeof g!=='object'||typeof g.name!=='string'||!Array.isArray(g.repNames)||g.repNames.some(n=>typeof n!=='string')))throw new Error('Choose a Research Groups JSON export containing group names and representative memberships.');
  const groups=(state.researchGroups||[]).map(normalizeResearchGroup);
  for(const entry of incoming){const group=normalizeResearchGroup(entry),match=groups.find(g=>g.id===group.id)||groups.find(g=>researchGroupNameKey(g.name)===researchGroupNameKey(group.name));if(match){match.repNames=normalizeResearchGroup({...match,repNames:[...match.repNames,...group.repNames]}).repNames;match.updatedAt=new Date().toISOString();}else groups.push(group);}
  state.researchGroups=groups;if(!activeResearchGroup())state.activeResearchGroupId=groups[0]?.id||'';researchGroupStatus(`${incoming.length.toLocaleString()} research groups imported. Existing matching groups kept their members and added imported names.`);researchGroupSaveAndRender();return groups;
}
function renderResearchGroupBuilder(){if(researchGroupsUi.groupId&&researchGroupsUi.groupId!==state.activeResearchGroupId)researchGroupResetReview();return renderResearchGroups();}
function cancelResearchGroupMatching(){if(!researchGroupsUi.running)return;researchGroupsUi.job++;researchGroupsUi.running=false;researchGroupStatus('Matching cancelled. Group membership was not changed.');renderResearchGroups();}
function researchGroupMatchSuggestions(value){const query=researchGroupNameKey(value),suggestions=researchGroupNode('researchGroupRepSuggestions');if(!suggestions)return;suggestions.innerHTML=(researchGroupsUi.index?.entries||[]).filter(r=>!query||researchGroupNameKey(r.name).includes(query)).slice(0,RESEARCH_GROUP_PAGE_SIZE).map(r=>`<option value="${esc(r.name)}">${esc(r.coaches.join(' · '))}</option>`).join('');}
function initResearchGroups(){
  if(researchGroupsUi.initialized)return;researchGroupsUi.initialized=true;
  const bind=(id,event,fn)=>{const node=researchGroupNode(id);if(node)node.addEventListener(event,fn);};
  bind('createResearchGroupBtn','click',createResearchGroup);
  bind('researchGroupSearchInput','input',event=>{researchGroupsUi.groupSearch=event.target.value;researchGroupsUi.groupPage=0;renderResearchGroups();});
  bind('researchGroupRepSearchInput','input',event=>{researchGroupsUi.repSearch=event.target.value;researchGroupsUi.availablePage=0;renderResearchGroups();});
  bind('researchGroupSelectedSearchInput','input',event=>{researchGroupsUi.selectedSearch=event.target.value;researchGroupsUi.selectedPage=0;renderResearchGroups();});
  bind('saveResearchGroupBtn','click',()=>{const group=activeResearchGroup(),name=researchGroupNode('researchGroupNameInput')?.value.trim();if(!group)return;if(!name)return researchGroupStatus('Enter a group name.');if((state.researchGroups||[]).some(g=>g.id!==group.id&&researchGroupNameKey(g.name)===researchGroupNameKey(name)))return researchGroupStatus('A group already uses that name. Choose a different name.');group.name=name;group.updatedAt=new Date().toISOString();researchGroupStatus('Research group saved.');researchGroupSaveAndRender();});
  bind('duplicateResearchGroupBtn','click',()=>{const group=activeResearchGroup();if(!group)return;researchGroupResetReview();let name=group.name+' copy',number=2;while(findResearchGroup(name))name=group.name+' copy '+number++;const copy=normalizeResearchGroup({...group,id:id(),name,createdAt:new Date().toISOString()});state.researchGroups.push(copy);state.activeResearchGroupId=copy.id;researchGroupStatus('Research group duplicated.');researchGroupSaveAndRender();});
  bind('deleteResearchGroupBtn','click',()=>{const group=activeResearchGroup();if(!group||!confirm(`Delete research group "${group.name}"? Saved Research items that use it will need another group.`))return;researchGroupResetReview();state.researchGroups=state.researchGroups.filter(g=>g.id!==group.id);state.activeResearchGroupId=state.researchGroups[0]?.id||'';researchGroupStatus('Research group deleted.');researchGroupSaveAndRender();});
  bind('clearResearchGroupBtn','click',()=>{const group=activeResearchGroup();if(!group||!group.repNames.length||!confirm('Remove all representatives from this research group?'))return;group.repNames=[];group.updatedAt=new Date().toISOString();researchGroupStatus('Research group membership cleared.');researchGroupSaveAndRender();});
  bind('researchGroupMatchBtn','click',previewResearchGroupPaste);
  bind('researchGroupCancelMatchBtn','click',cancelResearchGroupMatching);
  bind('researchGroupApplyMatchesBtn','click',applyResearchGroupMatches);
  bind('exportResearchGroupsBtn','click',exportResearchGroups);
  bind('importResearchGroupsFile','change',async event=>{const file=event.target.files?.[0];if(!file)return;try{importResearchGroups(await file.text());}catch(error){researchGroupStatus('Import failed: '+error.message);}finally{event.target.value='';}});
  bind('researchGroupBuilderModal','click',event=>{
    const ui=researchGroupsUi,target=event.target.closest('button');if(!target)return;
    if(target.dataset.close==='researchGroupBuilderModal')cancelResearchGroupMatching();
    if(target.hasAttribute('data-group-page')){const key={researchGroupListPager:'groupPage',researchGroupRepPager:'availablePage',researchGroupSelectedPager:'selectedPage',researchGroupReviewPager:'reviewPage'}[target.parentElement.id];if(key){ui[key]+=Number(target.dataset.groupPage);key==='reviewPage'?renderResearchGroupReview():renderResearchGroups();}}
    if(ui.running)return;
    if(target.hasAttribute('data-research-group-id')){const next=target.dataset.researchGroupId;if(next!==state.activeResearchGroupId){researchGroupResetReview();state.activeResearchGroupId=next;ui.selectedPage=0;researchGroupStatus('');renderResearchGroups();}}
    if(target.hasAttribute('data-research-group-remove')){const group=activeResearchGroup();if(group){const key=researchGroupRepKey(target.dataset.researchGroupRemove);group.repNames=group.repNames.filter(n=>researchGroupRepKey(n)!==key);group.updatedAt=new Date().toISOString();researchGroupSaveAndRender();}}
    if(target.hasAttribute('data-research-group-skip')){const row=ui.review[Number(target.dataset.researchGroupSkip)];if(row){row.skipped=!row.skipped;row.approved=false;renderResearchGroupReview();}}
  });
  bind('researchGroupBuilderModal','change',event=>{
    const ui=researchGroupsUi,node=event.target;if(ui.running)return;
    if(node.hasAttribute('data-research-group-rep')){const group=activeResearchGroup(),entry=ui.index?.byKey.get(node.dataset.researchGroupRep);if(group&&entry){group.repNames=group.repNames.filter(n=>researchGroupRepKey(n)!==entry.key);if(node.checked)group.repNames.push(entry.name);group.updatedAt=new Date().toISOString();researchGroupSaveAndRender();}}
    if(node.hasAttribute('data-research-group-match')){const row=ui.review[Number(node.dataset.researchGroupMatch)];if(row){row.matchName=node.value;row.approved=false;row.skipped=false;renderResearchGroupReview();}}
    if(node.hasAttribute('data-research-group-approve')){const row=ui.review[Number(node.dataset.researchGroupApprove)],entry=row&&ui.index?.byKey.get(researchGroupRepKey(row.matchName));if(row){if(node.checked&&!entry){row.approved=false;researchGroupStatus('Choose an imported representative name before approving this match.');}else{row.approved=!!node.checked;row.matchName=entry?.name||row.matchName;}renderResearchGroupReview();}}
  });
  bind('researchGroupBuilderModal','input',event=>{if(event.target.hasAttribute('data-research-group-match'))researchGroupMatchSuggestions(event.target.value);});
  bind('researchGroupBuilderModal','focusin',event=>{if(event.target.hasAttribute('data-research-group-match'))researchGroupMatchSuggestions(event.target.value);});
}
