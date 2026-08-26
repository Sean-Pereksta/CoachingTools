from pathlib import Path
import re

root = Path('CoachTools')
patch_path = root / 'build' / 'performance-scorecard-ranking-patch.txt'
build_path = root / 'build' / 'build-performance-scorecard-enhanced.js'
test_path = root / 'tests' / 'performance-scorecard-ranking.test.js'

patch = patch_path.read_text(encoding='utf-8')

export_block = r'''function installExportSafeCloneStyles(doc){const body=doc.body;if(body){body.classList.add('scorecardExportSafe');for(const [name,value] of Object.entries({'--goal-good-bg':'var(--panel2)','--goal-bad-bg':'var(--panel2)','--goal-good-hover':'var(--panel2)','--goal-bad-hover':'var(--panel2)','--row-hover-bg':'var(--panel2)','--active-bg':'var(--panel2)'}))body.style.setProperty(name,value,'important')}const style=doc.createElement('style');style.dataset.scorecardExportSafe='true';style.textContent=`body.scorecardExportSafe .main .summary.metric:after{display:none!important;background:none!important}body.scorecardExportSafe .main .metricCell.goalMet{background:var(--panel2)!important;box-shadow:inset 0 0 0 2px var(--good)!important}body.scorecardExportSafe .main .metricCell.goalMiss{background:var(--panel2)!important;box-shadow:inset 0 0 0 2px var(--bad)!important}body.scorecardExportSafe .main .quickFilter.active{background:var(--panel2)!important;border-color:var(--accent)!important;color:var(--accent)!important}body.scorecardExportSafe .main .statusBadge.strong,body.scorecardExportSafe .main .statusBadge.healthy{background:var(--panel2)!important;border-color:var(--good)!important;color:var(--good)!important}body.scorecardExportSafe .main .statusBadge.watch{background:var(--panel2)!important;border-color:var(--warn)!important;color:var(--warn)!important}body.scorecardExportSafe .main .statusBadge.attention{background:var(--panel2)!important;border-color:var(--bad)!important;color:var(--bad)!important}body.scorecardExportSafe .main .statusBadge.building{background:var(--panel2)!important;border-color:var(--accent3)!important;color:var(--accent3)!important}`;doc.head.appendChild(style)}
async function captureScorecardCanvas(){const target=document.querySelector('.main'),workspace=$('scorecardWorkspace'),wrap=workspace?.querySelector('.tableWrap'),table=wrap?.querySelector('table');if(!target||!workspace||!wrap||!table)throw new Error('Scorecard is not ready to export.');const exportWidth=Math.ceil(Math.max(target.getBoundingClientRect().width,target.scrollWidth,table.scrollWidth+28)),estimatedHeight=Math.ceil(target.scrollHeight+Math.max(0,wrap.scrollHeight-wrap.clientHeight)),pixelBudget=28000000,scale=Math.max(.72,Math.min(2,Math.sqrt(pixelBudget/Math.max(1,exportWidth*estimatedHeight))));return window.html2canvas(target,{backgroundColor:null,scale,useCORS:true,logging:false,windowWidth:Math.max(document.documentElement.clientWidth,exportWidth),windowHeight:Math.max(document.documentElement.clientHeight,estimatedHeight),onclone:doc=>{installExportSafeCloneStyles(doc);const clone=doc.querySelector('.main'),cloneWorkspace=doc.getElementById('scorecardWorkspace'),cloneWrap=cloneWorkspace?.querySelector('.tableWrap'),cloneTable=cloneWrap?.querySelector('table');if(clone){clone.style.width=`${exportWidth}px`;clone.style.maxWidth='none';clone.style.margin='0';clone.style.padding='18px';clone.style.background='var(--theme-bg)';clone.style.backgroundColor='var(--bg)'}if(cloneWorkspace){cloneWorkspace.style.width='100%';cloneWorkspace.style.maxWidth='none'}if(cloneWrap){cloneWrap.style.maxHeight='none';cloneWrap.style.overflow='visible'}if(cloneTable){cloneTable.style.width='100%';cloneTable.style.minWidth=`${Math.max(1080,table.scrollWidth)}px`}const exportMenu=doc.getElementById('scorecardExportMenu');if(exportMenu)exportMenu.style.display='none';const full=doc.getElementById('fullscreenBtn');if(full)full.style.display='none'}})}'''

pattern = r"async function captureScorecardCanvas\(\)\{.*?\}\nasync function exportScorecardPng"
patch, count = re.subn(pattern, export_block + "\nasync function exportScorecardPng", patch, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'Expected one captureScorecardCanvas block, replaced {count}')

patch, count = re.subn(
    r"function installScorecardExtraStyles\(\)\{[^\n]*\}",
    "function installScorecardExtraStyles(){if(document.querySelector('[data-scorecard-extras]'))return}",
    patch,
    count=1,
)
if count != 1:
    raise SystemExit(f'Expected one installScorecardExtraStyles function, replaced {count}')
patch_path.write_text(patch, encoding='utf-8')

build = build_path.read_text(encoding='utf-8')
old = "const PATCH_PATH = path.join(__dirname, 'performance-scorecard-ranking-patch.txt');"
new = old + "\nconst EXTRA_STYLE_PATH = path.join(ROOT, 'shared', 'performance-scorecard-extras.css');"
if old not in build:
    raise SystemExit('Could not add EXTRA_STYLE_PATH')
build = build.replace(old, new, 1)

old = "const patch = rankingPatch();"
new = old + "\nconst extrasStyle = fs.readFileSync(EXTRA_STYLE_PATH, 'utf8').trim();"
if old not in build:
    raise SystemExit('Could not load enhanced styles')
build = build.replace(old, new, 1)

anchor = "const marker = \"window.addEventListener('error',e=>console.error('[Performance Scorecard]',e.error||e.message));\";"
injection = "source = requiredReplace(\n  source,\n  '</head>',\n  `<style data-scorecard-extras=\\\"true\\\">\\n${extrasStyle}\\n</style>\\n</head>`,\n  'enhanced scorecard styles'\n);\n\n" + anchor
if anchor not in build:
    raise SystemExit('Could not find enhanced style injection anchor')
build = build.replace(anchor, injection, 1)
build_path.write_text(build, encoding='utf-8')

test = test_path.read_text(encoding='utf-8')
anchor = "assert.ok(!enhanced.includes('new XMLHttpRequest'), 'enhanced scorecard must not use XHR to load local HTML');"
additions = """assert.ok(enhanced.includes('data-scorecard-extras=\"true\"'), 'enhanced scorecard should inline enhanced-only styles for file:// safety');
assert.ok(enhanced.includes('function installExportSafeCloneStyles(doc)'), 'scorecard export should sanitize unsupported CSS color functions in the clone');
assert.ok(enhanced.includes('scorecardExportSafe .main .summary.metric:after'), 'export clone should disable unsupported color-mix radial pseudo gradients');
assert.ok(!enhanced.includes(\"link.href='../shared/performance-scorecard-extras.css'\"), 'enhanced scorecard should not reload local enhanced CSS inside html2canvas clones');"""
if anchor not in test:
    raise SystemExit('Could not find test insertion anchor')
test = test.replace(anchor, anchor + "\n" + additions, 1)
test_path.write_text(test, encoding='utf-8')
