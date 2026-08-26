from pathlib import Path

path = Path('CoachTools/apps/performance-scorecard.html')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    "button,input,select{font:inherit;color:inherit}button{cursor:pointer}",
    "button,input,select{font:inherit;color:inherit}body.galactic select{color-scheme:dark;background:#160d2b!important;color:#fbf7ff!important;border-color:rgba(199,157,255,.32)!important}body.galactic select option{background:#160d2b;color:#fbf7ff}button{cursor:pointer}",
    'galactic select styling'
)

replace_once(
    "people:[], byId:new Map(), records:{}, histories:{weeklyRetail:[],weeklyReferral:[]}, weeklyByRep:new Map(), qaByRep:new Map(), coachingByRep:new Map(), checklistByRep:new Map(),",
    "people:[], byId:new Map(), records:{}, histories:{weeklyRetail:[],weeklyReferral:[]}, weeklyByRep:new Map(), qaByRep:new Map(), coachingByRep:new Map(), checklistByRep:new Map(), scopeByRep:new Map(),",
    'scope state'
)

anchor = "function indexQA(record){const fn=window.CoachToolsProfiles?._test?.canonicalizeQA;if(!fn||!record)return;const resolve=raw=>{const c=candidatesFor(raw,'representative');return c.length===1?c[0].personId:''};for(const q of fn(record,resolve)||[]){if(!q.representativeId)continue;push(state.qaByRep,q.representativeId,q)}}"
scope_fn = """function indexCurrentScope(){
  state.scopeByRep.clear();
  for(const type of ['weeklyRetail','weeklyReferral']){
    const record=state.records[type];if(!record)continue;const department=type==='weeklyReferral'?'Referral':'Retail';
    for(const pack of extract(record))for(const row of pack.rows||[]){
      const repRaw=pick(row,['Representative','Representative Name','Associate Name','Agent Name','AgentName','Employee','Name']);if(!clean(repRaw))continue;
      const rep=resolveRep(repRaw,null,department);if(!rep)continue;
      const coachRaw=pick(row,['Job Coach','Coach Assigned','Coach','Coach Name'])||pack.sheet;
      const current=state.scopeByRep.get(rep.personId)||{};
      state.scopeByRep.set(rep.personId,{...current,department,coachName:clean(coachRaw),coachKey:norm(coachRaw)});
    }
  }
  const qa=state.records.qa,parseDate=window.CoachToolsProfiles?._test?.parseDate,latestTeam=new Map();
  if(qa)for(const pack of extract(qa))for(const row of pack.rows||[]){
    const repRaw=pick(row,['Agent Name','Agent','CSR','Associate','Representative','Rep','Name']);const team=clean(pick(row,['Team']));if(!clean(repRaw)||!team)continue;
    const c=candidatesFor(repRaw,'representative');if(c.length!==1)continue;
    const date=parseDate?parseDate(pick(row,['Interaction Start Time','Interaction Start','Start Time','Interaction Time'])):null;
    const stamp=date&&!Number.isNaN(date.getTime())?date.getTime():0,prev=latestTeam.get(c[0].personId);
    if(!prev||stamp>=prev.stamp)latestTeam.set(c[0].personId,{team,stamp});
  }
  for(const [personId,entry] of latestTeam){const current=state.scopeByRep.get(personId)||{};state.scopeByRep.set(personId,{...current,team:entry.team,teamKey:norm(entry.team)})}
}
function scopeFor(rep){const observed=state.scopeByRep.get(rep.personId)||{};return{department:clean(observed.department||rep.department),team:clean(observed.team),teamKey:observed.teamKey||norm(observed.team),coachName:clean(observed.coachName),coachKey:observed.coachKey||norm(observed.coachName)}}
function personTeam(rep){return scopeFor(rep).team}
function personDepartment(rep){return scopeFor(rep).department}
function personCoachKey(rep){return scopeFor(rep).coachKey}
function indexQA(record){const fn=window.CoachToolsProfiles?._test?.canonicalizeQA;if(!fn||!record)return;const resolve=raw=>{const c=candidatesFor(raw,'representative');return c.length===1?c[0].personId:''};for(const q of fn(record,resolve)||[]){if(!q.representativeId)continue;push(state.qaByRep,q.representativeId,q)}}"""
replace_once(anchor, scope_fn, 'current scope index')

replace_once(
    "state.records=await CoachToolsAppData.getMany(['weeklyRetail','weeklyReferral','qa','documentedCoaching','checklist'],{includeRecord:true,continueOnError:true,progressUi:false,appId:'performance-scorecard'});loadingStep(2,42,'Indexing current QA, coaching and checklist…');await nextPaint();\n  indexQA(state.records.qa);",
    "state.records=await CoachToolsAppData.getMany(['weeklyRetail','weeklyReferral','qa','documentedCoaching','checklist'],{includeRecord:true,continueOnError:true,progressUi:false,appId:'performance-scorecard'});loadingStep(2,42,'Indexing current QA, coaching and checklist…');await nextPaint();\n  indexCurrentScope();indexQA(state.records.qa);",
    'load current scope'
)

replace_once(
    "function personCoach(rep){return rep.currentCoachId?state.byId.get(rep.currentCoachId):null}\nfunction selectedWindow(){return Number($('windowSel').value)||8}\nfunction baseScopedReps(){const dept=$('departmentSel').value,team=$('teamSel').value,coach=$('coachSel').value;return state.people.filter(p=>p.role==='representative').filter(p=>dept==='All'||p.department===dept).filter(p=>!team||team==='__ALL__'||clean(p.currentTeam||p.team)===team).filter(p=>!coach||coach==='__ALL__'||p.currentCoachId===coach)}\nfunction scopedReps(){const q=norm($('searchInp').value);return baseScopedReps().filter(p=>!q||norm([p.displayName,p.currentTeam,p.department,personCoach(p)?.displayName].filter(Boolean).join(' ')).includes(q))}\nfunction teamCohortFor(rep){const team=clean(rep.currentTeam||rep.team),key=`${rep.department}|${team}|${rep.currentCoachId||''}`;if(state.cohortCache.has(key))return state.cohortCache.get(key);const reps=state.people.filter(p=>p.role==='representative'&&p.department===rep.department);let cohort=team?reps.filter(p=>clean(p.currentTeam||p.team)===team):[];if(cohort.length<5&&rep.currentCoachId)cohort=reps.filter(p=>p.currentCoachId===rep.currentCoachId);if(cohort.length<5)cohort=reps;state.cohortCache.set(key,cohort);return cohort}",
    "function personCoach(rep){const s=scopeFor(rep);return s.coachName?{personId:`scope:${s.coachKey}`,displayName:s.coachName}:null}\nfunction selectedWindow(){return Number($('windowSel').value)||8}\nfunction baseScopedReps(){const dept=$('departmentSel').value,team=$('teamSel').value,coach=$('coachSel').value;return state.people.filter(p=>p.role==='representative').filter(p=>dept==='All'||personDepartment(p)===dept).filter(p=>!team||team==='__ALL__'||scopeFor(p).teamKey===team).filter(p=>!coach||coach==='__ALL__'||personCoachKey(p)===coach)}\nfunction scopedReps(){const q=norm($('searchInp').value);return baseScopedReps().filter(p=>!q||norm([p.displayName,personTeam(p),personDepartment(p),personCoach(p)?.displayName].filter(Boolean).join(' ')).includes(q))}\nfunction teamCohortFor(rep){const s=scopeFor(rep),key=`${s.department}|${s.teamKey}|${s.coachKey}`;if(state.cohortCache.has(key))return state.cohortCache.get(key);const reps=state.people.filter(p=>p.role==='representative'&&personDepartment(p)===s.department);let cohort=s.teamKey?reps.filter(p=>scopeFor(p).teamKey===s.teamKey):[];if(cohort.length<5&&s.coachKey)cohort=reps.filter(p=>personCoachKey(p)===s.coachKey);if(cohort.length<5)cohort=reps;state.cohortCache.set(key,cohort);return cohort}",
    'scope filtering'
)

replace_once(
    "const dept=state.byId.get(personId)?.department;",
    "const dept=state.byId.get(personId)?personDepartment(state.byId.get(personId)):'';",
    'performance department'
)

replace_once(
    "${esc([r.rep.currentTeam||r.rep.team,c&&c.displayName].filter(Boolean).join(' · '))}",
    "${esc([personTeam(r.rep),c&&c.displayName].filter(Boolean).join(' · '))}",
    'representative meta'
)

replace_once(
    "function populateFilters(){const reps=state.people.filter(p=>p.role==='representative'),teams=[...new Set(reps.map(p=>clean(p.currentTeam||p.team)).filter(Boolean))].sort(),coaches=state.people.filter(p=>p.role==='coach').sort((a,b)=>a.displayName.localeCompare(b.displayName));$('teamSel').innerHTML=`<option value=\"__ALL__\">All teams</option>`+teams.map(x=>`<option>${esc(x)}</option>`).join('');$('coachSel').innerHTML=`<option value=\"__ALL__\">All coaches</option>`+coaches.map(x=>`<option value=\"${esc(x.personId)}\">${esc(x.displayName)}</option>`).join('')}",
    "function populateFilters(){const oldTeam=$('teamSel').value||'__ALL__',oldCoach=$('coachSel').value||'__ALL__',dept=$('departmentSel').value,reps=state.people.filter(p=>p.role==='representative').filter(p=>dept==='All'||personDepartment(p)===dept),teams=new Map(),coaches=new Map();for(const rep of reps){const s=scopeFor(rep);if(s.teamKey&&!teams.has(s.teamKey))teams.set(s.teamKey,s.team);if(s.coachKey&&!coaches.has(s.coachKey))coaches.set(s.coachKey,s.coachName)}const teamRows=[...teams].sort((a,b)=>a[1].localeCompare(b[1])),coachRows=[...coaches].sort((a,b)=>a[1].localeCompare(b[1]));$('teamSel').innerHTML=`<option value=\"__ALL__\">All teams</option>`+teamRows.map(([key,name])=>`<option value=\"${esc(key)}\">${esc(name)}</option>`).join('');$('coachSel').innerHTML=`<option value=\"__ALL__\">All coaches</option>`+coachRows.map(([key,name])=>`<option value=\"${esc(key)}\">${esc(name)}</option>`).join('');$('teamSel').value=teams.has(oldTeam)?oldTeam:'__ALL__';$('coachSel').value=coaches.has(oldCoach)?oldCoach:'__ALL__'}",
    'filter options'
)

replace_once(
    "$('profileMeta').textContent=[rep.department,rep.currentTeam||rep.team,coach&&`Coach ${coach.displayName}`,`${row.kpiHistory} observed KPI weeks`].filter(Boolean).join(' · ');",
    "$('profileMeta').textContent=[personDepartment(rep),personTeam(rep),coach&&`Coach ${coach.displayName}`,`${row.kpiHistory} observed KPI weeks`].filter(Boolean).join(' · ');",
    'profile scope meta'
)

replace_once(
    "for(const id of ['departmentSel','teamSel','coachSel','windowSel'])$(id).addEventListener('change',()=>{if(id==='departmentSel')renderColumnList();if(id==='windowSel')resetCalcCache();render()});",
    "for(const id of ['departmentSel','teamSel','coachSel','windowSel'])$(id).addEventListener('change',()=>{if(id==='departmentSel'){populateFilters();renderColumnList()}if(id==='windowSel')resetCalcCache();render()});",
    'department filter refresh'
)

path.write_text(text, encoding='utf-8')
