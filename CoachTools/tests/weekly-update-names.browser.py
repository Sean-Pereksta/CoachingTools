"""Chromium contract harness for the standalone workflow and legacy builder boundary.

Run: python tests/weekly-update-names.browser.py
Requires Playwright and Chromium; CHROMIUM_PATH may select a system executable.
This exercises the production formatter and Update Names module against the existing
builder DOM/API/event contract, not the complete stats assembly/XLSX engine.
"""
import csv
import io
import os
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = r'''<!doctype html><html><head><meta charset="utf-8"><style>
[hidden]{display:none!important}body{font:15px Arial;margin:24px}.panel{padding:16px;border:1px solid #ccc;margin:12px 0}.controls,.upload-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}button,select,input{padding:8px}.hint{font-size:13px}td,th{padding:8px;border:1px solid #ddd}
</style></head><body><span id="modeTag">ADD MODE</span><button id="resetBtn">Reset</button><button id="demoBtn">Demo</button>
<section class="upload-grid" id="uploadGrid"><article id="card-appointments">Appointment report</article><article id="card-wipers">Wiper report</article><article id="card-weekly"><label>Built stats file<input type="file" id="file-weekly"></label><p id="status-weekly"></p><span id="loading-weekly" hidden>Loading</span></article></section>
<section class="controls"><div><select id="updateMode"><option value="add">Add</option><option value="modify">Modify</option></select><p id="modeHint">Add a week</p></div><div class="date-field"><input type="date" id="publicationDate" required></div><div>Stats options</div><div class="build-group"><button id="buildBtn">Build preview</button></div></section>
<section class="stats-settings">Saved replacements</section><div id="globalStatus"></div><div id="emptyState">No result</div><div id="results" hidden></div><div id="kpis"></div>
<script>
const $=id=>document.getElementById(id);
const state={mode:'add',sources:{weekly:{},appointments:{},wipers:{}},stale:false,result:null};
window.legacyModeEvents=0;window.assemblyCalls=0;
window.WeeklyCore={assemble(){assemblyCalls++;throw Error('Stats assembler must not run in Update Names');},assembleModify(){assemblyCalls++;throw Error('Modify assembler must not run in Update Names');},
 csv(rows){return '\uFEFF'+rows.map(r=>r.map(v=>{const s=v==null?'':String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\r\n');}};
window.exportDepartment='retail';
window.WeeklyBuilder={getExportFileName:()=>exportDepartment==='referral'?'Referral Weekly.csv':'Retail Weekly.csv',getSources:()=>state.sources,getMode:()=>state.mode,getResult:()=>state.result,getStats:()=>state.result?.stats||null,isStale:()=>state.stale,isModifyFinalized:()=>false};
$('updateMode').addEventListener('change',()=>{legacyModeEvents++;state.mode=$('updateMode').value==='modify'?'modify':'add';$('updateMode').value=state.mode;$('modeTag').textContent=state.mode.toUpperCase();$('modeHint').textContent=state.mode;state.stale=true;});
$('publicationDate').addEventListener('input',()=>{state.stale=true;});
$('file-weekly').addEventListener('change',async()=>{
 const file=$('file-weekly').files[0],s=state.sources.weekly={loading:true,fileName:file.name,version:Date.now()};
 $('loading-weekly').hidden=false;$('status-weekly').textContent='Reading';
 await new Promise(resolve=>setTimeout(resolve,150));
 try {if(file.name==='bad.csv')throw Error('Invalid built stats file');s.rows=(await file.text()).split(/\r?\n/).map(line=>line.split(','));s.analysis={headerRow:0,dims:{date:0,coach:1,name:2,manager:-1}};window.dispatchEvent(new CustomEvent('weekly-builder-sources-change'));}
 catch(e){s.error=e.message;$('status-weekly').textContent=e.message;}
 finally{s.loading=false;$('loading-weekly').hidden=true;}
});
$('resetBtn').addEventListener('click',()=>{state.sources.weekly={};$('file-weekly').value='';$('status-weekly').textContent='No file';$('publicationDate').value='';$('updateMode').value=state.mode;$('modeTag').textContent=state.mode;window.dispatchEvent(new CustomEvent('weekly-builder-sources-change'));});
</script><script id="weekly-builder-update-names-script"></script></body></html>'''

# Load scripts directly into an offline page; capture the export Blob for inspection.
with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser = p.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'])
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(HTML)
    for script in ('weekly-data-builder-names.js', 'weekly-data-builder-update-names.js'):
        page.add_script_tag(path=str(ROOT / 'shared' / script))
    page.evaluate('''() => { window.URL.createObjectURL = blob => {window.exportBlob = blob; return 'blob:contract-test';}; HTMLAnchorElement.prototype.click = function() {window.exportDownload = this.download;}; }''')
    expect(page.locator('#updateMode option[value="update-names"]')).to_have_count(1)
    page.select_option('#updateMode', 'update-names')
    assert page.evaluate('WeeklyBuilder.getMode()') == 'update-names'
    assert page.evaluate('legacyModeEvents') == 0
    for selector in ['#card-appointments', '#card-wipers', '.date-field', '.stats-settings', '.build-group']:
        expect(page.locator(selector)).not_to_be_visible()
    expect(page.locator('#card-weekly')).to_be_visible()
    expect(page.locator('#updateNamesPreview')).to_be_disabled()
    page.select_option('#nameCapitalization', 'title')
    raw = 'Date,Sheet,Name,Cash AR,Notes\n9/20/2026,john doe,JANE SMITH,0.500,KEEP ALL TEXT\n,,,,\n9/27/2026,JOHN DOE,Jane Smith,0,UNTOUCHED'
    page.set_input_files('#file-weekly', {'name': 'Weekly.csv', 'mimeType': 'text/csv', 'buffer': raw.encode()})
    expect(page.locator('#updateNamesPreview')).to_be_enabled()
    assert page.input_value('#publicationDate') == ''
    page.click('#updateNamesPreview')
    expect(page.locator('#updateNamesExport')).to_be_enabled()
    expect(page.locator('#updateNamesSummary')).to_contain_text('3 name cells in 2 rows')
    original_rows = list(csv.reader(io.StringIO(raw)))
    assert page.evaluate('WeeklyBuilder.getSources().weekly.rows') == original_rows
    page.click('#updateNamesExport')
    assert page.evaluate('exportDownload') == 'Retail Weekly.csv'
    page.evaluate("exportDepartment='referral'")
    page.click('#updateNamesExport')
    assert page.evaluate('exportDownload') == 'Referral Weekly.csv'
    exported_text = page.evaluate('exportBlob.text()')
    exported = list(csv.reader(io.StringIO(exported_text.lstrip('\ufeff'))))
    assert len(exported) == len(original_rows)
    assert exported[1][1:3] == ['John Doe', 'Jane Smith']
    assert exported[3][1:3] == ['John Doe', 'Jane Smith']
    assert exported[2] == original_rows[2]
    for before, after in zip(original_rows, exported):
        assert before[0] == after[0] and before[3:] == after[3:]
    page.select_option('#nameCapitalization', 'lower')
    expect(page.locator('#updateNamesExport')).to_be_disabled()
    page.click('#updateNamesPreview')
    assert page.evaluate('WeeklyBuilder.getResult().allRows[1][2]') == 'jane smith'
    # Large changed-cell previews paginate, while exports keep every row.
    large = 'Date,Sheet,Name,Cash AR,Notes\n' + '\n'.join('9/27/2026,JOHN DOE,JANE SMITH,0,Keep' for _ in range(60))
    page.set_input_files('#file-weekly', {'name': 'Large.csv', 'mimeType': 'text/csv', 'buffer': large.encode()})
    expect(page.locator('#updateNamesExport')).to_be_disabled()
    expect(page.locator('#updateNamesPreview')).to_be_enabled()
    page.click('#updateNamesPreview')
    expect(page.locator('#updateNamesChanges tr')).to_have_count(50)
    page.click('#updateNamesNext')
    expect(page.locator('#updateNamesPage')).to_contain_text('Page 2 / 3')
    assert page.evaluate('WeeklyBuilder.getResult().allRows.length') == 61
    # Reader failures never leave the old preview exportable.
    page.set_input_files('#file-weekly', {'name': 'bad.csv', 'mimeType': 'text/csv', 'buffer': b'invalid'})
    expect(page.locator('#updateNamesStatus')).to_contain_text('Invalid built stats file')
    expect(page.locator('#updateNamesExport')).to_be_disabled()
    page.click('#resetBtn')
    expect(page.locator('#updateMode')).to_have_value('update-names')
    expect(page.locator('#updateNamesPreview')).to_be_disabled()
    expect(page.locator('#updateNamesReview')).not_to_be_visible()
    assert page.evaluate('assemblyCalls') == 0
    # Original two-mode handlers receive control again when leaving this mode.
    page.select_option('#updateMode', 'modify')
    assert page.evaluate('WeeklyBuilder.getMode()') == 'modify'
    assert page.evaluate('legacyModeEvents') == 1
    expect(page.locator('.date-field')).to_be_visible()
    expect(page.locator('#card-appointments')).to_be_visible()
    expect(page.locator('#updateNamesWorkspace')).not_to_be_visible()
    page.select_option('#updateMode', 'add')
    assert page.evaluate('WeeklyBuilder.getMode()') == 'add'
    assert page.evaluate('legacyModeEvents') == 2
    page.select_option('#updateMode', 'update-names')
    page.evaluate('WeeklyBuilderUpdateNames.mount(window)')
    expect(page.locator('#updateMode option[value="update-names"]')).to_have_count(1)
    assert not errors, errors
    browser.close()
    print('PASS: Chromium contract harness — one-file workflow, CSV export contents, invariants, stale locks, pagination, reset, mode switching and duplicate-mount protection; no page errors.')
