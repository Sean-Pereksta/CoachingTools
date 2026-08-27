(function installPerformanceScorecardWorkbookVisuals(root) {
  'use strict';

  const doc = root.document || null;
  if (!doc) return;

  const VERSION = '1.0.0';
  const VIEW_PREF_KEY = 'coachtools.performanceScorecard.workbookView.v1';
  const COLUMN_PREF_KEY = 'coachtools.performanceScorecard.workbookColumns.v1';
  const VIEW_MODES = new Set(['normal', 'basic', 'advanced']);
  const scriptPromises = new Map();
  const moduleScriptUrl = (() => {
    try { return doc.currentScript && doc.currentScript.src ? new URL(doc.currentScript.src, root.location.href) : null; }
    catch (_) { return null; }
  })();

  let initialized = false;
  let visualApplyQueued = false;
  let visualObserverInstalled = false;
  let themeObserverInstalled = false;
  let workbookViewMode = loadViewPreference();

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }
  function normalizeViewMode(value) {
    const mode = clean(value).toLowerCase();
    return VIEW_MODES.has(mode) ? mode : 'normal';
  }
  function loadViewPreference() {
    try { return normalizeViewMode(root.localStorage?.getItem(VIEW_PREF_KEY) || 'normal'); }
    catch (_) { return 'normal'; }
  }
  function saveViewPreference(mode) {
    try { root.localStorage?.setItem(VIEW_PREF_KEY, normalizeViewMode(mode)); } catch (_) {}
  }
  function assetSource(fileName) {
    try { return moduleScriptUrl ? new URL(`../vendor/${fileName}`, moduleScriptUrl).href : `../vendor/${fileName}`; }
    catch (_) { return `../vendor/${fileName}`; }
  }
  function loadScript(source, ready) {
    if (ready()) return Promise.resolve();
    if (scriptPromises.has(source)) return scriptPromises.get(source);
    const promise = new Promise((resolve, reject) => {
      const existing = [...doc.scripts].find(script => script.src === source);
      const script = existing || doc.createElement('script');
      script.addEventListener('load', () => ready() ? resolve() : reject(new Error(`Loaded ${source} but its export API was unavailable.`)), { once: true });
      script.addEventListener('error', () => reject(new Error(`Could not load ${source}.`)), { once: true });
      if (!existing) {
        script.src = source;
        script.async = true;
        script.dataset.scorecardWorkbookVisualDependency = 'true';
        doc.head.appendChild(script);
      }
    });
    scriptPromises.set(source, promise);
    return promise;
  }
  async function ensureExportLibraries(format) {
    await loadScript(assetSource('html2canvas.min.js'), () => typeof root.html2canvas === 'function');
    if (format === 'pdf') await loadScript(assetSource('jspdf.umd.min.js'), () => Boolean(root.jspdf && root.jspdf.jsPDF));
  }
  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create workbook image.')), 'image/png'));
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = name;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  function exportFileName(ext) {
    const department = clean(doc.getElementById('psUploadDepartment')?.value || 'workbook').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workbook';
    const stamp = new Date().toISOString().slice(0, 10);
    return `performance-scorecard-workbook-${department}-${stamp}.${ext}`;
  }

  function injectStyles() {
    if (doc.getElementById('psWorkbookVisualStyles')) return;
    const style = doc.createElement('style');
    style.id = 'psWorkbookVisualStyles';
    style.textContent = `
#psUploadOverlay .psUploadShell{max-width:1880px}
#psUploadOverlay .psUploadTop{padding:9px 10px;margin-bottom:8px}
#psUploadOverlay .psUploadTitle h2{font-size:18px}
#psUploadOverlay .psUploadTitle p{font-size:9px}
#psUploadOverlay .psUploadActions{gap:5px}
#psUploadOverlay .psUploadCtl{min-height:34px;padding:4px 6px}
#psUploadOverlay .psUploadCtl label{font-size:8px}
#psUploadOverlay .psUploadCtl select,#psUploadOverlay .psUploadCtl input{font-size:10px}
#psUploadOverlay .psUploadBtn{padding:7px 9px;font-size:10px}
#psUploadOverlay .psUploadSummary{gap:6px;margin-bottom:7px}
#psUploadOverlay .psUploadSummaryCard{padding:8px 10px;border-radius:11px}
#psUploadOverlay .psUploadSummaryLabel{font-size:8px}
#psUploadOverlay .psUploadSummaryValue{font-size:19px;margin-top:2px}
#psUploadOverlay .psUploadSummarySub{font-size:8px;margin-top:1px}
#psUploadOverlay .psUploadNotice{padding:7px 9px;margin-bottom:7px;font-size:8px}
#psUploadOverlay .psWorkbookResultsLayout{display:grid;grid-template-columns:minmax(0,1fr) 258px;gap:8px;align-items:start}
#psUploadOverlay .psWorkbookColumnRail{position:sticky;top:88px;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--soft-shadow);padding:9px;max-height:calc(100vh - 108px);overflow:auto}
#psUploadOverlay .psWorkbookRailTitle{font-family:var(--font-display);font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.06em;color:var(--ink);margin:1px 2px 7px}
#psUploadOverlay .psWorkbookRailHint{font-size:8px;line-height:1.35;color:var(--muted);font-weight:750;margin:0 2px 8px}
#psUploadOverlay #psUploadColumns{display:block;width:100%}
#psUploadOverlay #psUploadColumns>summary{display:none}
#psUploadOverlay #psUploadColumnMenu{position:static;inset:auto;width:auto;border:0;border-radius:0;background:transparent;box-shadow:none;padding:0}
#psUploadOverlay .psUploadColumnRow{padding:6px 5px;border:1px solid transparent;border-radius:8px}
#psUploadOverlay .psUploadColumnRow:hover{border-color:var(--line);background:var(--panel2)}
#psUploadOverlay .psUploadWorkspaceHead{padding:7px 9px}
#psUploadOverlay .psUploadMeta{font-size:8px;line-height:1.35}
#psUploadOverlay .psUploadTableWrap{max-height:calc(100vh - 250px);padding:0 5px 5px}
#psUploadOverlay .psUploadTable{border-collapse:separate!important;border-spacing:0 4px!important;min-width:720px}
#psUploadOverlay .psUploadTable th{padding:6px 7px;font-size:8px}
#psUploadOverlay .psUploadTable tbody td{background:var(--panel2);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:5px 7px;vertical-align:middle}
#psUploadOverlay .psUploadTable tbody td:first-child{border-left:1px solid var(--line);border-radius:9px 0 0 9px;min-width:170px}
#psUploadOverlay .psUploadTable tbody td:last-child{border-right:1px solid var(--line);border-radius:0 9px 9px 0}
#psUploadOverlay .psUploadTable tbody tr:hover td{background:var(--panel)}
#psUploadOverlay .psUploadTable tbody td:first-child>b{display:block;padding:5px 7px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:7px;background:var(--panel);font-family:var(--font-display);font-size:10px;line-height:1.15}
#psUploadOverlay .psUploadMetricMain{font-size:13px;line-height:1.05}
#psUploadOverlay .psUploadMetricSub{font-size:7px;margin-top:0;line-height:1.15}
#psUploadOverlay .psUploadWeeks{gap:2px;margin-top:1px;flex-wrap:nowrap}
#psUploadOverlay .psUploadWeeks span{padding:1px 3px;font-size:6px;white-space:nowrap}
#psUploadOverlay .psWorkbookExportMenu{position:relative}
#psUploadOverlay .psWorkbookExportMenu>summary{list-style:none}
#psUploadOverlay .psWorkbookExportMenu>summary::-webkit-details-marker{display:none}
#psUploadOverlay .psWorkbookExportMenuList{position:absolute;right:0;top:calc(100% + 5px);z-index:40;min-width:138px;padding:6px;display:grid;gap:5px;border:1px solid var(--line);border-radius:11px;background:var(--panel);box-shadow:var(--shadow)}
#psUploadOverlay .psWorkbookExportMenuList button{text-align:left;white-space:nowrap}
#psUploadOverlay[data-ps-view="basic"] .psUploadSummaryCard{padding:6px 8px}
#psUploadOverlay[data-ps-view="basic"] .psUploadSummaryValue{font-size:17px}
#psUploadOverlay[data-ps-view="basic"] .psUploadSummarySub{display:none}
#psUploadOverlay[data-ps-view="basic"] .psUploadWorkspaceHead{padding:5px 8px}
#psUploadOverlay[data-ps-view="basic"] .psUploadTableWrap{max-height:calc(100vh - 220px)}
#psUploadOverlay[data-ps-view="basic"] .psUploadTable{border-spacing:0 2px!important}
#psUploadOverlay[data-ps-view="basic"] .psUploadTable th{padding:4px 6px;font-size:7px}
#psUploadOverlay[data-ps-view="basic"] .psUploadTable tbody td{padding:2px 6px;height:27px;white-space:nowrap}
#psUploadOverlay[data-ps-view="basic"] .psUploadTable tbody td:first-child>b{padding:3px 6px;font-size:9px}
#psUploadOverlay[data-ps-view="basic"] .psUploadMetricMain{display:inline-block;font-size:12px;vertical-align:middle}
#psUploadOverlay[data-ps-view="basic"] .psUploadMetricSub{display:none!important}
#psUploadOverlay[data-ps-view="basic"] .psUploadMetricMain+.psUploadMetricSub{display:inline-block!important;margin-left:7px;font-size:7px;color:var(--muted);vertical-align:middle}
#psUploadOverlay[data-ps-view="basic"] .psUploadWeeks{display:none!important}
#psUploadOverlay[data-ps-view="normal"] .psUploadTable tbody td{padding:3px 7px;height:34px;white-space:nowrap}
#psUploadOverlay[data-ps-view="normal"] .psUploadMetricMain{display:inline-block;vertical-align:middle;margin-right:7px}
#psUploadOverlay[data-ps-view="normal"] .psUploadMetricSub{display:inline-block;margin-right:7px;vertical-align:middle}
#psUploadOverlay[data-ps-view="normal"] .psUploadWeeks{display:none!important}
#psUploadOverlay[data-ps-view="advanced"] .psUploadTable tbody td{padding:3px 7px;height:39px;white-space:nowrap}
#psUploadOverlay[data-ps-view="advanced"] .psUploadMetricMain{display:inline-block;vertical-align:middle;margin-right:6px}
#psUploadOverlay[data-ps-view="advanced"] .psUploadMetricSub{display:inline-block;margin-right:6px;vertical-align:middle}
#psUploadOverlay[data-ps-view="advanced"] .psUploadWeeks{display:inline-flex;vertical-align:middle;margin:0 0 0 2px}
#psUploadOverlay.psWorkbookExportSafe .psUploadTop,#psUploadOverlay.psWorkbookExportSafe .psUploadDrop,#psUploadOverlay.psWorkbookExportSafe .psUploadError,#psUploadOverlay.psWorkbookExportSafe .psUploadNotice{background:var(--panel)!important;border-color:var(--line)!important;backdrop-filter:none!important}
#psUploadOverlay.psWorkbookExportSafe .psUploadTable tbody tr:hover td{background:var(--panel2)!important}
#psUploadOverlay.psWorkbookExportSafe .psWorkbookColumnRail{display:none!important}
#psUploadOverlay.psWorkbookExportSafe .psWorkbookResultsLayout{display:block!important}
#psUploadOverlay.psWorkbookExportSafe .psUploadActions{display:none!important}
@media(max-width:1100px){#psUploadOverlay .psWorkbookResultsLayout{grid-template-columns:1fr}#psUploadOverlay .psWorkbookColumnRail{position:static;max-height:none;order:-1}#psUploadOverlay #psUploadColumns>summary{display:block;width:100%}#psUploadOverlay #psUploadColumnMenu{margin-top:6px}#psUploadOverlay #psUploadColumns:not([open]) #psUploadColumnMenu{display:none}}
@media(max-width:680px){#psUploadOverlay .psUploadTable{min-width:620px}#psUploadOverlay .psUploadTop{position:relative}.psWorkbookExportMenuList{right:auto;left:0}}
`;
    doc.head.appendChild(style);
  }

  function mainThemeSelect() { return doc.getElementById('themeSel'); }
  function workbookThemeSelect() { return doc.getElementById('psUploadThemeSel'); }
  function syncThemeOptions() {
    const source = mainThemeSelect(), target = workbookThemeSelect();
    if (!target) return;
    const wanted = source?.value || clean(doc.body?.dataset?.theme) || target.value || 'galactic';
    if (source) {
      const signature = [...source.options].map(option => `${option.value}:${option.textContent}`).join('|');
      if (target.dataset.optionSignature !== signature) {
        target.innerHTML = '';
        for (const option of source.options) target.appendChild(option.cloneNode(true));
        target.dataset.optionSignature = signature;
      }
    }
    if ([...target.options].some(option => option.value === wanted)) target.value = wanted;
  }
  function installThemeControl(actions) {
    if (doc.getElementById('psUploadThemeSel')) return;
    const control = doc.createElement('div');
    control.className = 'psUploadCtl';
    control.dataset.psWorkbookVisualControl = 'theme';
    control.innerHTML = '<label>Theme</label><select id="psUploadThemeSel" aria-label="Workbook scorecard theme"></select>';
    const choose = doc.getElementById('psUploadChoose');
    actions.insertBefore(control, choose || actions.firstChild);
    syncThemeOptions();
    workbookThemeSelect().addEventListener('change', event => {
      const source = mainThemeSelect();
      if (source && [...source.options].some(option => option.value === event.target.value)) {
        source.value = event.target.value;
        source.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (doc.body) doc.body.dataset.theme = event.target.value;
    });
    const source = mainThemeSelect();
    if (source && !themeObserverInstalled) {
      source.addEventListener('change', syncThemeOptions);
      const observer = new MutationObserver(syncThemeOptions);
      observer.observe(source, { childList: true, subtree: true });
      themeObserverInstalled = true;
    }
  }

  function currentMainDisplayMode() {
    const value = doc.getElementById('displayModeSel')?.value;
    return VIEW_MODES.has(value) ? value : '';
  }
  function setWorkbookViewMode(mode, syncMain) {
    const normalized = normalizeViewMode(mode);
    workbookViewMode = normalized;
    saveViewPreference(normalized);
    const overlay = doc.getElementById('psUploadOverlay');
    if (overlay) overlay.dataset.psView = normalized;
    const select = doc.getElementById('psUploadDisplayMode');
    if (select && select.value !== normalized) select.value = normalized;
    if (syncMain) {
      const main = doc.getElementById('displayModeSel');
      if (main && main.value !== normalized) {
        main.value = normalized;
        main.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }
  function syncViewFromMain() {
    const mainMode = currentMainDisplayMode();
    if (mainMode) setWorkbookViewMode(mainMode, false);
    else setWorkbookViewMode(workbookViewMode, false);
  }
  function installDisplayControl(actions) {
    if (doc.getElementById('psUploadDisplayMode')) return;
    const control = doc.createElement('div');
    control.className = 'psUploadCtl';
    control.dataset.psWorkbookVisualControl = 'display';
    control.innerHTML = '<label>Display</label><select id="psUploadDisplayMode" aria-label="Workbook scorecard display mode"><option value="normal">Normal</option><option value="basic">Basic</option><option value="advanced">Advanced</option></select>';
    const choose = doc.getElementById('psUploadChoose');
    actions.insertBefore(control, choose || actions.firstChild);
    syncViewFromMain();
    doc.getElementById('psUploadDisplayMode').addEventListener('change', event => setWorkbookViewMode(event.target.value, true));
    const main = doc.getElementById('displayModeSel');
    if (main && main.dataset.workbookVisualSync !== 'true') {
      main.dataset.workbookVisualSync = 'true';
      main.addEventListener('change', () => setWorkbookViewMode(main.value, false));
    }
  }

  function installColumnRail() {
    const results = doc.getElementById('psUploadResults');
    const workspace = results?.querySelector('.psUploadWorkspace');
    const columns = doc.getElementById('psUploadColumns');
    if (!results || !workspace || !columns) return;
    let layout = results.querySelector('.psWorkbookResultsLayout');
    if (!layout) {
      layout = doc.createElement('div');
      layout.className = 'psWorkbookResultsLayout';
      workspace.parentNode.insertBefore(layout, workspace);
      layout.appendChild(workspace);
    }
    let rail = doc.getElementById('psUploadColumnRail');
    if (!rail) {
      rail = doc.createElement('aside');
      rail.id = 'psUploadColumnRail';
      rail.className = 'psWorkbookColumnRail';
      rail.innerHTML = '<div class="psWorkbookRailTitle">Workbook Columns</div><div class="psWorkbookRailHint">Show or hide the live workbook KPI columns. Changes stay editable without affecting stored scorecard data.</div>';
      layout.appendChild(rail);
    }
    if (columns.parentNode !== rail) rail.appendChild(columns);
    columns.open = true;
    const summary = columns.querySelector('summary');
    if (summary) summary.textContent = '☰ Workbook Columns';
  }

  function persistCoverageOff() {
    try {
      const saved = JSON.parse(root.localStorage?.getItem(COLUMN_PREF_KEY) || '{}') || {};
      if (saved.coverage !== false) {
        saved.coverage = false;
        root.localStorage?.setItem(COLUMN_PREF_KEY, JSON.stringify(saved));
      }
    } catch (_) {}
  }
  function removeWorkbookCoverageColumn() {
    persistCoverageOff();
    const input = doc.querySelector('#psUploadColumnMenu [data-ps-column="coverage"]');
    if (input && input.checked) {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    input?.closest('.psUploadColumnRow')?.remove();
    const header = doc.querySelector('#psUploadTableHead [data-ps-sort="coverage"]');
    if (!header) return;
    const row = header.parentElement;
    const index = row ? [...row.children].indexOf(header) : -1;
    if (index >= 0) {
      header.remove();
      for (const bodyRow of doc.querySelectorAll('#psUploadTableBody tr')) bodyRow.children[index]?.remove();
    }
  }

  function installExportMenu() {
    if (doc.getElementById('psUploadExportMenu')) return;
    const oldButton = doc.getElementById('psUploadSnip');
    if (!oldButton) return;
    const details = doc.createElement('details');
    details.id = 'psUploadExportMenu';
    details.className = 'psWorkbookExportMenu';
    details.innerHTML = '<summary class="psUploadBtn">✂ Snip</summary><div class="psWorkbookExportMenuList"><button class="psUploadBtn" type="button" data-ps-workbook-export="png">PNG image</button><button class="psUploadBtn" type="button" data-ps-workbook-export="pdf">PDF document</button></div>';
    oldButton.replaceWith(details);
    details.addEventListener('click', event => {
      const button = event.target.closest('[data-ps-workbook-export]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      details.removeAttribute('open');
      runWorkbookExport(button.dataset.psWorkbookExport, button);
    });
  }
  async function captureWorkbookCanvas() {
    const target = doc.querySelector('#psUploadOverlay .psUploadShell');
    const overlay = doc.getElementById('psUploadOverlay');
    const wrap = doc.querySelector('#psUploadOverlay .psUploadTableWrap');
    const table = wrap?.querySelector('table');
    if (!target || !overlay || !wrap || !table) throw new Error('Workbook scorecard is not ready to export.');
    const exportWidth = Math.ceil(Math.max(target.getBoundingClientRect().width, table.scrollWidth + 36));
    const estimatedHeight = Math.ceil(target.scrollHeight + Math.max(0, wrap.scrollHeight - wrap.clientHeight));
    const scale = Math.max(.72, Math.min(2, Math.sqrt(28000000 / Math.max(1, exportWidth * estimatedHeight))));
    overlay.classList.add('psWorkbookExportSafe', 'psUploadExportSafe');
    try {
      return await root.html2canvas(target, {
        backgroundColor: null,
        scale,
        useCORS: true,
        logging: false,
        windowWidth: Math.max(doc.documentElement.clientWidth, exportWidth),
        windowHeight: Math.max(doc.documentElement.clientHeight, estimatedHeight),
        onclone: cloned => {
          const clonedOverlay = cloned.getElementById('psUploadOverlay');
          const clonedTarget = cloned.querySelector('#psUploadOverlay .psUploadShell');
          const clonedWrap = cloned.querySelector('#psUploadOverlay .psUploadTableWrap');
          const clonedTable = clonedWrap?.querySelector('table');
          clonedOverlay?.classList.add('psWorkbookExportSafe', 'psUploadExportSafe');
          if (clonedTarget) {
            clonedTarget.style.width = `${exportWidth}px`;
            clonedTarget.style.maxWidth = 'none';
            clonedTarget.style.margin = '0';
          }
          if (clonedWrap) {
            clonedWrap.style.maxHeight = 'none';
            clonedWrap.style.overflow = 'visible';
          }
          if (clonedTable) {
            clonedTable.style.width = '100%';
            clonedTable.style.minWidth = `${Math.max(720, table.scrollWidth)}px`;
          }
          cloned.getElementById('psUploadExportMenu')?.remove();
          cloned.getElementById('psUploadColumnRail')?.remove();
          cloned.querySelector('#psUploadOverlay .psWorkbookResultsLayout')?.style.setProperty('display', 'block', 'important');
        }
      });
    } finally {
      overlay.classList.remove('psWorkbookExportSafe', 'psUploadExportSafe');
    }
  }
  async function exportWorkbookPng() {
    await ensureExportLibraries('png');
    const canvas = await captureWorkbookCanvas();
    downloadBlob(await canvasBlob(canvas), exportFileName('png'));
  }
  async function exportWorkbookPdf() {
    await ensureExportLibraries('pdf');
    const canvas = await captureWorkbookCanvas();
    const jsPDF = root.jspdf?.jsPDF;
    if (!jsPDF) throw new Error('PDF export library is unavailable.');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
    const margin = 18, pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const usableWidth = pageWidth - margin * 2, usableHeight = pageHeight - margin * 2;
    const pxPerPoint = canvas.width / usableWidth, slicePixels = Math.max(1, Math.floor(usableHeight * pxPerPoint));
    let page = 0;
    for (let y = 0; y < canvas.height; y += slicePixels) {
      const height = Math.min(slicePixels, canvas.height - y), part = doc.createElement('canvas');
      part.width = canvas.width;
      part.height = height;
      const context = part.getContext('2d');
      context.drawImage(canvas, 0, y, canvas.width, height, 0, 0, canvas.width, height);
      if (page++) pdf.addPage('letter', 'landscape');
      pdf.addImage(part.toDataURL('image/png'), 'PNG', margin, margin, usableWidth, height / pxPerPoint, undefined, 'FAST');
    }
    pdf.save(exportFileName('pdf'));
  }
  async function runWorkbookExport(format, button) {
    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = format === 'pdf' ? 'Building PDF…' : 'Snipping PNG…';
    }
    try {
      if (format === 'pdf') await exportWorkbookPdf();
      else await exportWorkbookPng();
    } catch (error) {
      console.error('[Performance Scorecard Workbook Visuals] export failed', error);
      const box = doc.getElementById('psUploadError');
      if (box) {
        box.textContent = `Workbook export failed: ${error.message || error}`;
        box.classList.remove('hide');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText || format.toUpperCase();
      }
    }
  }

  function applyVisualState() {
    visualApplyQueued = false;
    const overlay = doc.getElementById('psUploadOverlay');
    if (!overlay) return;
    setWorkbookViewMode(workbookViewMode, false);
    installColumnRail();
    removeWorkbookCoverageColumn();
    syncThemeOptions();
  }
  function scheduleVisualState() {
    if (visualApplyQueued) return;
    visualApplyQueued = true;
    const run = () => applyVisualState();
    if (root.requestAnimationFrame) root.requestAnimationFrame(run); else root.setTimeout(run, 0);
  }
  function watchWorkbookRenders() {
    if (visualObserverInstalled) return;
    const overlay = doc.getElementById('psUploadOverlay');
    if (!overlay) return;
    const observer = new MutationObserver(scheduleVisualState);
    observer.observe(overlay, { childList: true, subtree: true });
    visualObserverInstalled = true;
  }

  function initialize() {
    if (initialized) return true;
    const overlay = doc.getElementById('psUploadOverlay');
    const actions = overlay?.querySelector('.psUploadActions');
    if (!overlay || !actions) return false;
    initialized = true;
    injectStyles();
    installThemeControl(actions);
    installDisplayControl(actions);
    installColumnRail();
    installExportMenu();
    persistCoverageOff();
    syncViewFromMain();
    removeWorkbookCoverageColumn();
    watchWorkbookRenders();
    doc.addEventListener('click', event => {
      if (!event.target.closest('#psUploadModeBtn')) return;
      syncThemeOptions();
      syncViewFromMain();
      scheduleVisualState();
    }, true);
    return true;
  }
  function waitForWorkbookUi() {
    if (initialize()) return;
    const observer = new MutationObserver(() => {
      if (!initialize()) return;
      observer.disconnect();
    });
    observer.observe(doc.documentElement || doc, { childList: true, subtree: true });
  }

  root.CoachToolsPerformanceScorecardWorkbookVisuals = Object.freeze({
    VERSION,
    refresh: scheduleVisualState,
    setViewMode(mode) { setWorkbookViewMode(mode, true); scheduleVisualState(); }
  });

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', waitForWorkbookUi, { once: true });
  else waitForWorkbookUi();
})(typeof window !== 'undefined' ? window : globalThis);
