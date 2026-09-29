from pathlib import Path
import re

p=Path('CoachTools/apps/weekly-data-builder.html')
s=p.read_text()
def once(old,new):
 global s
 if s.count(old)!=1: raise RuntimeError(f'Expected one builder anchor, got {s.count(old)}: {old[:110]}')
 s=s.replace(old,new,1)

once("'employee supervisor name'].includes(h)) return 'coach';", "'employee supervisor name','employee immediate supervisor name'].includes(h)) return 'coach';\n    if (['manager','manager name','manger','manger name','employee manager name','employee second level supervisor name'].includes(h)) return 'manager';")
once("      if (/\\b(accepted|accepts|count|counts|sold|sales)\\b/.test(n)) return 'wiper.accepted';\n      if (/\\b(offered|offers|asked|jobs|job)\\b/.test(n)) return 'wiper.offered';", "      if (/\\b(offered|offers|asked|jobs|job)\\b/.test(n)) return 'wiper.offered';\n      if (/\\b(accepted|accepts|count|counts|sold|sales)\\b/.test(n)) return 'wiper.accepted';")
s=s.replace("['name','coach','date']","['name','coach','manager','date']")
once("    for(const d of ['name','coach','manager','date']) if(Number.isInteger(overrides[d])) dims[d]=overrides[d];", "    if(kind==='appointments' && dims.name<0 && firstMetric===4 && cols.slice(0,4).every(c=>!c.raw)) {\n      dims.manager=0; dims.coach=1; dims.name=2; dims.date=3;\n      notices.push('Unlabeled appointment columns detected: A = manager, B = coach, C = representative, D = report period.');\n    }\n    for(const d of ['name','coach','manager','date']) if(Number.isInteger(overrides[d])) dims[d]=overrides[d];")
once("  function sourceRecords(rows,analysis,opts={}) {", "  function sourceRecords(rows,analysis,opts={}) {\n    if(analysis.kind!=='weekly' && analysis.periods.length>1 && !opts.period) throw new Error('Choose one source period for the '+analysis.kind+' report before building weekly statistics.');\n    const directory=root.CoachToolsStatsDirectory;\n    if(directory) rows=directory.rewriteRows(rows,analysis).rows;")
once("const nk=nameKey(name), ck=tidy(coach).toLowerCase(), identity=", "const nk=nameKey(name), ck=nameKey(coach), identity=")
once("name,nameKey:nk,coach:ck,candidates:", "name,nameKey:nk,coach:ck,displayCoach:coach,manager:analysis.dims.manager>=0?tidy(row[analysis.dims.manager]):(directory?.managerFor(coach)||''),candidates:")
once("c.index!==analysis.dims.date && c.index!==analysis.dims.name && c.index!==analysis.dims.coach", "!Object.values(analysis.dims).includes(c.index)")
# A selected role-specific name rule can join to older weekly names without rewriting history.
once("  function assembleModify(input) {", "  function representativeKey(value) { return nameKey(root.CoachToolsStatsDirectory?.resolve(value,'name') || value); }\n  function coachKey(value) { return nameKey(root.CoachToolsStatsDirectory?.resolve(value,'coach') || value); }\n  function assembleModify(input) {")
once("nameKey(previousRows[i][ta.dims.name])", "representativeKey(previousRows[i][ta.dims.name])")
once("const row=working[i],name=tidy(row[ta.dims.name]),nk=nameKey(name);", "const row=working[i],name=tidy(row[ta.dims.name]),nk=representativeKey(name);")
start=s.index('    function appointmentFor(row,nk,rowNumber){')
end=s.index('    function sourceValue(m,a,w){',start)
s=s[:start]+'''    const targetNameCounts=new Map();
    for(const i of targetIndexes){const nk=representativeKey(previousRows[i][ta.dims.name]);targetNameCounts.set(nk,(targetNameCounts.get(nk)||0)+1);}
    function recordFor(map,row,nk,rowNumber,source,preferredCoach){
      const candidates=map.get(nk)||[];if(!candidates.length)return null;
      const coach=coachKey(preferredCoach || (ta.dims.coach>=0?row[ta.dims.coach]:''));
      const exact=coach?candidates.filter(a=>a.coach===coach):[];
      if(exact.length===1)return exact[0];
      if(candidates.length===1 && targetNameCounts.get(nk)===1)return candidates[0];
      const id=source+'|'+nk+'|'+rowNumber;
      if(!ambiguousKeys.has(id)){ambiguousKeys.add(id);review.push({kind:'ambiguous-modify',name:tidy(row[ta.dims.name]),source,row:String(rowNumber),message:'The name and coach do not identify one unique '+source+' record. These fields were held for review, not applied to an arbitrary person.'});}
      return null;
    }
'''+s[end:]
once("const a=aa?appointmentFor(row,nk,i+1):null,w=wa?(wiByName.get(nk)||[])[0]||null:null;", "const a=aa?recordFor(apByName,row,nk,i+1,'appointments'):null,w=wa?recordFor(wiByName,row,nk,i+1,'wipers',a?.coach):null;")
# Preserve source display spelling and retain a wiper-only representative's coach.
s=s.replace("coach=a?.coach||''", "coach=a?.displayCoach||a?.coach||w?.displayCoach||w?.coach||''")
once("if(m.dimension==='coach')return a&&a.coach?safeNewText(a.coach,protectedText):'';", "if(m.dimension==='coach')return a&&a.coach?safeNewText(a.displayCoach||a.coach,protectedText):'';\n      if(m.dimension==='manager')return a?.manager?safeNewText(a.manager,protectedText):'';")
once("else if(m.dimension==='coach')v=a?.coach?safeNewText(a.coach,protectedText):'';", "else if(m.dimension==='coach')v=safeNewText(coach,protectedText);else if(m.dimension==='manager')v=safeNewText(a?.manager||w?.manager||'',protectedText);")
once("        if(m.dimension==='name')return safeNewText(name,protectedText);", "        if(m.dimension==='name')return safeNewText(name,protectedText);\n        if(m.dimension==='manager')return safeNewText(a?.manager||w?.manager||'',protectedText);")
once("      if(dim==='coach')return {index:i,target:h,dimension:dim,source:aa?'appointments':'',status:aa?'mapped':'blank',description:aa?'Appointment coach may update Sheet / Coach.':'No appointment file supplied; Sheet / Coach stays unchanged.'};", "      if(dim==='coach'||dim==='manager')return {index:i,target:h,dimension:dim,source:aa?'appointments':'',status:aa?'mapped':'blank',description:aa?'Appointment '+dim+' may update this identity column.':'No appointment file supplied; this identity column stays unchanged.'};")
s=s.replace("dim==='coach'?'Appointment coach → lowercase':'Representative name'", "dim==='coach'?'Coach from appointment or wiper report':dim==='manager'?'Manager from the source or saved coach group':'Representative name'")
# Ensure Add-new Modify never arbitrarily pairs two duplicate names across coaches.
once("const w=ws.find(x=>!pairedWipers.has(x.id))||null;", "const remaining=ws.filter(x=>!pairedWipers.has(x.id)),exact=remaining.filter(x=>x.coach===a.coach);const w=exact.length===1?exact[0]:(remaining.length===1&&aps.filter(x=>x.nameKey===a.nameKey).length===1?remaining[0]:null);")
# Browser inputs / settings integration.
once('<script id="core-script">','<script src="../shared/coachtools-stats-directory.js"></script>\n<script id="core-script">')
once('<label>Date / period<select id="date-${key}"', '<label>Manager column<select id="manager-${key}" aria-label="${d.title} manager column"></select></label><label>Date / period<select id="date-${key}"')
once("function sourceReady(key){const s=state.sources[key];return !!(s&&s.rows&&s.analysis&&!s.loading&&!s.error);}", "function sourceReady(key){const s=state.sources[key];return !!(s&&s.rows&&s.analysis&&!s.loading&&!s.error&&(key==='weekly'||s.analysis.periods.length<2||s.period));}")
once("function ready(){if(", "let statsSettingsLoaded=false;\nCoachToolsStatsDirectory.ready.then(()=>{statsSettingsLoaded=true;syncButtons();}).catch(e=>status('Saved settings could not be loaded: '+e.message,'error'));\nfunction ready(){if(!statsSettingsLoaded)return false;if(")
once("'<option value=\"\">All source periods</option>'+periods.map", "'<option value=\"\">'+(periods.length>1?'Choose one source period (required)':'All source periods')+'</option>'+periods.map")
once("  syncButtons();\n}\nfunction sourceOptions()", "  syncButtons();window.dispatchEvent(new CustomEvent('weekly-builder-sources-change'));\n}\nfunction sourceOptions()")
once("window.WeeklyBuilder={getStats:", "window.addEventListener('coachtools-stats-directory-change',()=>{invalidate();window.dispatchEvent(new CustomEvent('weekly-builder-sources-change'));});\nwindow.WeeklyBuilder={getSources:()=>state.sources,getStats:")
once("status('');updateModeUI();}\nfunction demo()", "status('');updateModeUI();window.dispatchEvent(new CustomEvent('weekly-builder-sources-change'));}\nfunction demo()")
once("version:'1.1'};", "version:'1.2'};")
s=s.replace('Weekly Data Builder · v1.1','Weekly Data Builder · v1.2').replace('name="coachtools-version" content="1.1"','name="coachtools-version" content="1.2"')
s=s.replace('They are included at the end with a blank Sheet.','They are included with their wiper-source coach when available.').replace('Included at the end with a blank Sheet and blank appointment fields.','Included with the wiper-source coach and blank appointment fields.').replace('No appointment coach','No source coach')
s=s.replace('This is a self-contained file. It does not transmit reports, load remote scripts, save reports to browser storage, or modify the originals. Reopening the tool starts a fresh session.', 'This workspace uses local CoachTools support scripts. It does not transmit reports, load remote scripts, save report statistics to browser storage, or modify the originals. Manager groups and explicit name-replacement rules are saved separately in this browser; reopening clears the uploaded reports, not those settings.')
once('</body></html>', '<script src="../shared/weekly-data-builder-settings.js"></script>\n</body></html>')
p.write_text(s)

p=Path('CoachTools/shared/coachtools-import.js');s=p.read_text()
bootstrap='''
  // Load small shared settings once. Discovery remains bounded; no report is ingested here.
  const statsSettingsReady = root.CoachToolsStatsSettingsReady || (root.CoachToolsStatsSettingsReady = (() => {
    if (!root.document) return Promise.resolve();
    const scriptUrl = root.document.currentScript && root.document.currentScript.src;
    function load(name, file) {
      if (root[name]) return Promise.resolve(root[name]);
      return new Promise((resolve, reject) => {
        const script = root.document.createElement('script');
        script.src = new URL(file, scriptUrl || root.location.href).href;
        script.onload = () => resolve(root[name]);
        script.onerror = () => reject(new Error('Could not load local stats settings: ' + file));
        root.document.head.appendChild(script);
      });
    }
    return load('CoachToolsStatsDirectory', 'coachtools-stats-directory.js').then(async directory => {
      await directory.ready;
      if (!root.CoachToolsStatsManagerPickerLoaded) {
        root.CoachToolsStatsManagerPickerLoaded = true;
        await load('CoachToolsStatsManagerPicker', 'coachtools-stats-manager-picker.js');
      }
    });
  })());
  // Surface failure when an upload is attempted, without an unhandled startup rejection.
  statsSettingsReady.catch(error => { root.console?.warn('[Stats settings]', error.message); });
'''
s=s.replace("  'use strict';", "  'use strict';\n"+bootstrap,1)
for name in ['discoverFile','resolveScopeSnapshot','materializeDiscoveredEntry']:
 pattern=rf'(async function {name}\([^)]*\)\s*\{{)'
 if len(re.findall(pattern,s))!=1:raise RuntimeError('Missing unique async import hook: '+name)
 s=re.sub(pattern,lambda m:m.group(1)+'\n    await statsSettingsReady;',s,count=1)
# All callers converge on this preparation method, including Clean Upload and Update Data.
anchor='    source = aliases[source] || source;'
if s.count(anchor)!=1:raise RuntimeError('Missing source-normalization anchor')
s=s.replace(anchor,anchor+'''\n    if(root.CoachToolsStatsDirectory){
      parsed=root.CoachToolsStatsDirectory.applyDataset(parsed,source);
      scope=root.CoachToolsStatsDirectory.mapScope(scope,source);
    }''',1)
# Prevent pre-filtering by an old spelling from dropping rows before saved rules run.
pattern=r'(async function materializeDiscoveredEntry\(([^)]*)\)\s*\{\n    await statsSettingsReady;)'
m=re.search(pattern,s)
if not m:raise RuntimeError('Missing materialization hook')
entry=m.group(2).split(',')[0].strip()
s=s[:m.end()]+f"\n    if(['weeklyRetail','weeklyReferral'].includes({entry}.classification?.id) && root.CoachToolsStatsDirectory?.snapshot().aliases.some(a=>a.enabled!==false)) return parseFile({entry}.file);"+s[m.end():]
p.write_text(s)
print('Applied Weekly Builder and shared weekly-import integration.')
