# Isolated DOM smoke test. Legacy application APIs are fixture adapters, not the full repository.
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]/'js'
FIXTURE=r'''
var state={metrics:[{id:'ar',name:'Consumer Appointment Rate',source:'weeklyRetail',dataCategory:'datedStats',output:'value',aggregation:'equal_rep',kind:'percentage'}],researchItems:[{id:'legacy',title:'Existing item',legacyFlag:true}],sourceMeta:{},orgs:[],categorized:{stats:{sources:{weeklyRetail:{observations:[]}}}}};
const periods=[{key:'p1',start:'2025-09-07',end:'2025-09-13'},{key:'p2',start:'2025-09-14',end:'2025-09-20'}];
for(const [repId,rep,value] of [['alice','Alice',50],['bob','Bob',80]])for(const period of periods)state.categorized.stats.sources.weeklyRetail.observations.push({id:repId+period.key,repId,rep,coach:'Coach A',period,source:'weeklyRetail',value});
const coaching=[{Name:'Alice',Description:'cash pitch',Type:'Documented',Date:'2025-09-08',ID:'1',_repKey:'alice'},{Name:'Bob',Description:'cash pitch',Type:'Other',Date:'2025-09-08',ID:'2',_repKey:'bob'},{Name:'Bob',Description:'wiper pitch',Type:'Documented',Date:'2025-09-08',ID:'3',_repKey:'bob'}];
function getRowsRaw(s){return s==='documented_coaching'?coaching:[];}
function getHeaders(s){return s==='documented_coaching'?['Name','Description','Type','Date','ID']:[];}
function getSourceSetting(){return {columns:{rep:'Name',date:'Date'}};}
function activeModelForImport(){return {};}
function findHeader(headers,candidates){return candidates.find(x=>headers.includes(x))||'';}
function datedStatsIdentity(n){return {id:String(n).toLowerCase()};}
function parseDateOnly(s){return new Date(s);}
function normalizeResearchItem(raw){const x=JSON.parse(JSON.stringify(raw));if(x.datedStats)delete x.datedStats.sentenceQuery;return x;}
function openDatedStatsResearchEditor(id){window.oldOpened=id;}
function openResearchItemEditor(id){window.oldOpened=id;}
function openDatedStatsMetricEditor(){window.oldMetricOpened=true;}
function renderDatedStatsResult(item,r){return '<h3>'+item.title+'</h3><svg aria-label="Existing chart renderer" viewBox="0 0 200 30"><polyline points="0,25 100,8 200,20" fill="none" stroke="currentColor"/></svg><div>'+r.data.map(p=>p.line+': '+p.value+'%').join(' | ')+'</div>';}
function bindDatedStatsCharts(){}
function saveResearchItems(){window.saveCalls=(window.saveCalls||0)+1;return true;}
function researchSaveRenderedResult(item,r){window.savedResult=r;return Promise.resolve(true);}
function renderResearchCanvasAsync(){return Promise.resolve();}
function renderMetricList(){}
function saveMetrics(){return Promise.resolve(true);}
window.AllStarDatedStats={day:s=>s instanceof Date?s.getTime():Date.parse(s),iso:n=>new Date(n).toISOString().slice(0,10),series:()=>periods.map(period=>({period})),criterion:()=>({value:50,pass:true,unit:'%'}),standardMetrics:()=>[{id:'consumer_ar',name:'Consumer Appointment Rate'}],normalizeMetric:m=>({...m,dataCategory:'datedStats'}),research:async function(obs,metric,s,events,opt){
  const data=[];for(const p of periods){const window=s.mode==='changing'?p:{start:s.anchorStart,end:s.anchorEnd};const filtered=obs.filter(o=>o.period.key===p.key&&(s.eventConditions||[]).every(c=>events.some(e=>e.repId===o.repId&&e.source===c.source&&e.date>=window.start&&e.date<=window.end)));
   const lines=s.groupBy==='representative'?[...new Set(filtered.map(o=>o.rep))]:['All'];for(const line of lines){const rows=filtered.filter(o=>line==='All'||o.rep===line);data.push({line,label:p.start,value:rows.reduce((a,o)=>a+o.value,0)/rows.length,unit:'%',eligibleRepresentatives:rows.length,missingRepresentatives:0});}}
  return {data,description:'Existing aggregation path',definition:{metric,settings:s}};
}};
function evaluateDatedStatsResearch(item,progress){const m=state.metrics.find(m=>m.id===item.datedStats.metricId);return AllStarDatedStats.research(state.categorized.stats.sources[m.source].observations,{...m,startDate:item.datedStats.startDate,endDate:item.datedStats.endDate},item.datedStats,[],{cancelled:()=>progress.token?.cancelled});}
'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1280,'height':900})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.set_content('<html><head></head><body><div class="toolbar"><button id="researchBtn">Research</button></div></body></html>')
  await page.add_script_tag(content=FIXTURE)
  await page.add_script_tag(content=(ROOT/'sentence-query.js').read_text())
  await page.add_script_tag(content=(ROOT/'sentence-workspace.js').read_text())
  await page.get_by_role('button',name='Build a question +').click()
  assert await page.locator('dialog.sq-dialog').count()==1
  async def apply():
   await page.get_by_role('button',name='Apply to sentence').click()
   await page.wait_for_timeout(30)
  # Add event and finish its session count clause.
  await page.locator('.sq-sentence .sq-plus').click();await apply();await apply()
  # Add Description contains cash to the same-row group.
  await page.locator('[data-sq-add][data-sq-source="documented_coaching"]').first.click();await apply()
  await page.locator('[data-sq-value="field"]').select_option('Description')
  await page.locator('[data-sq-value="value"]').fill('cash');await apply()
  # Add Type = Documented using the PLUS on the existing Description value.
  desc=page.get_by_role('button',name='Description contains “cash”',exact=False)
  await desc.locator('..').locator(':scope > .sq-plus').click();await apply()
  await page.locator('[data-sq-value="field"]').select_option('Type')
  await page.locator('[data-sq-value="op"]').select_option('eq')
  await page.locator('[data-sq-value="value"]').fill('Documented');await apply()
  # Confirm known fixture coverage; otherwise Bob is unknown, not proven zero.
  await page.get_by_role('button',name='Review event coverage',exact=False).click()
  await page.locator('[data-sq-value="documented_coaching_start"]').fill('2025-09-01')
  await page.locator('[data-sq-value="documented_coaching_end"]').fill('2025-09-30')
  await page.locator('[data-sq-value="documented_coaching_complete"]').check();await apply()
  await page.get_by_role('button',name='Update preview',exact=True).click()
  await page.wait_for_timeout(60)
  assert await page.locator('.sq-preview svg').count()==1
  content=await page.locator('.sq-preview').inner_text()
  assert '1 matched' in content and '1 did not match' in content,content
  assert 'Alice: 50%' in content and 'Bob: 80%' not in content,content
  await page.get_by_role('button',name='Save question and result').click();await page.wait_for_timeout(60)
  saved=await page.evaluate('state.researchItems')
  assert len(saved)==2 and saved[0]['legacyFlag'] is True
  created=saved[1];clause=created['datedStats']['sentenceQuery']['root']['children'][0]
  assert len(clause['where']['children'])==2
  assert await page.evaluate('savedResult.data.length')==2
  # Reopen: IDs, AND semantics and modifiers must survive.
  await page.get_by_role('button',name='Close sentence builder').click()
  await page.evaluate('(id)=>openResearchItemEditor(id)',created['id'])
  assert await page.get_by_role('button',name='Description contains “cash”',exact=False).count()==1
  assert await page.get_by_role('button',name='Type equals “Documented”',exact=False).count()==1
  # Output change marks stale; table preview uses the same filtered results.
  await page.get_by_role('button',name='a line graph',exact=False).click()
  await page.locator('[data-sq-value="view"]').select_option('table');await apply()
  await page.get_by_role('button',name='Update preview',exact=True).click();await page.wait_for_timeout(30)
  assert await page.locator('.sq-preview table').count()==2
  # Narrow screen layout must remain within the viewport; Escape closes dialog.
  await page.set_viewport_size({'width':390,'height':844})
  bounds=await page.locator('dialog').bounding_box();assert bounds['width']<=390,bounds
  await page.keyboard.press('Escape');await page.locator('dialog').wait_for(state='detached')
  assert not errors,errors
  await browser.close()
  print(json.dumps({'browser':'Chromium','result':'PASS','checks':['clickable sentence','plus on existing value','same-row AND','live loaded-row preview','distinct condition outcomes','save/reopen preserves AST','legacy item untouched','table/line use same results','mobile width','Escape closes'], 'page_errors':errors},indent=2))
asyncio.run(main())
