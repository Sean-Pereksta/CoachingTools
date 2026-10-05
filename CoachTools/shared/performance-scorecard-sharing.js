/* Compact full-report image exports shared by stored-data and live-workbook scorecards. */
(function (root) {
  'use strict';
  const doc = root.document;
  function pages(rowCount, columnCount, rowsPerPage = 10, columnsPerPage = 4, identity = 0) {
    const result = [], metrics = Array.from({length: columnCount}, (_, i) => i).filter(i => i !== identity);
    for (let r = 0; r < rowCount; r += rowsPerPage) {
      for (let c = 0; c < Math.max(1, metrics.length); c += columnsPerPage) {
        result.push({start: r, end: Math.min(rowCount, r + rowsPerPage), columns: [identity, ...metrics.slice(c, c + columnsPerPage)]});
      }
    }
    return result;
  }
  function fullReport(rowCount, columnCount) { return {start:0,end:rowCount,columns:Array.from({length:columnCount},(_,i)=>i)}; }
  if (typeof module !== 'undefined') module.exports = {pages,fullReport};
  if (!doc) return;
  let active = false;
  const loads = new Map();
  function library(src, ready) {
    if (ready()) return Promise.resolve();
    if (!loads.has(src)) loads.set(src, new Promise((resolve, reject) => {
      const script = doc.createElement('script'); script.src = src;
      script.onload = () => ready() ? resolve() : reject(new Error('Export library unavailable.'));
      script.onerror = () => reject(new Error('Could not load export library. Try again.'));
      doc.head.append(script);
    }).catch(error => {loads.delete(src); throw error;}));
    return loads.get(src);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = doc.createElement('a');
    link.href = url; link.download = name; doc.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const toBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image creation failed.')), 'image/png'));
  // Resolve modern CSS colors before html2canvas's older color parser sees them.
  const pixel = doc.createElement('canvas'); pixel.width = pixel.height = 1;
  const pixelContext = pixel.getContext('2d', {willReadFrequently: true});
  const colors = new Map();
  function color(value) {
    if (!value || !/color\(|color-mix\(|okl|lab\(|lch\(/i.test(value)) return value;
    if (colors.has(value)) return colors.get(value);
    pixelContext.clearRect(0, 0, 1, 1); pixelContext.fillStyle = value; pixelContext.fillRect(0, 0, 1, 1);
    const [r,g,b,a] = pixelContext.getImageData(0,0,1,1).data, result = `rgba(${r},${g},${b},${a / 255})`;
    colors.set(value, result); return result;
  }
  function freeze(source) {
    const clone = source.cloneNode(true), originals = [source, ...source.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((node, index) => {
      const style = root.getComputedStyle(node), copy = copies[index];
      copy.removeAttribute('id'); copy.removeAttribute('class'); copy.removeAttribute('style');
      for (const key of ['display','flex-direction','align-items','font-family','font-weight','font-style','text-align','vertical-align','border-radius','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style']) copy.style.setProperty(key, style.getPropertyValue(key));
      for (const key of ['color','background-color','border-top-color','border-right-color','border-bottom-color','border-left-color']) copy.style.setProperty(key, color(style.getPropertyValue(key)));
      copy.style.fontSize = `${Math.max(12, Math.min(14, parseFloat(style.fontSize) || 12))}px`;
      copy.style.padding = '0'; copy.style.margin = '0'; copy.style.gap = '2px 4px';
      copy.style.lineHeight = '1.5'; copy.style.whiteSpace = 'normal'; copy.style.overflowWrap = 'anywhere';
      if (node.matches('b,strong,.metricMain,.psUploadMetricMain,.repNum')) copy.style.whiteSpace = 'nowrap';
      if (style.display === 'flex' || style.display === 'inline-flex') copy.style.flexWrap = 'wrap';
      copy.style.position = 'static'; copy.style.maxWidth = '100%'; copy.style.minWidth = '0';
      copy.style.letterSpacing = 'normal'; copy.style.boxShadow = 'none';
      // Badge outlines from the compact screen can cut through enlarged text.
      // Keep their text/background colors; only table cells draw export dividers.
      if (!node.matches('td,th')) copy.style.border = '0';
      if (node.matches('.goalMet,.psGoalMet,.goalMiss,.psGoalMiss')) {
        const goalColor = color(style.getPropertyValue(node.matches('.goalMet,.psGoalMet') ? '--good' : '--bad').trim());
        copy.style.borderLeft = `3px solid ${goalColor}`;
      }
      if (node.matches('button')) { copy.style.border = '0'; copy.style.background = 'transparent'; }
      // Compact rows contain several values separated by pipes. Larger export text
      // needs its own lines, not a non-wrapping flex row crossing neighboring cells.
      if (node.matches('.metricInline')) copy.style.display = 'block';
      if (node.parentElement?.matches('.metricInline')) {
        copy.style.display = 'block'; copy.style.marginTop = '2px';
        if (copy.firstChild?.nodeType === 3) copy.firstChild.textContent = copy.firstChild.textContent.replace(/^\s*\|\s*/, '');
      }
      if (node.matches('.metricMain,.psUploadMetricMain,.metricInline > b')) copy.style.fontSize = '14px';
    });
    clone.querySelectorAll('input,select,textarea,.goalEditor,.psUploadGoalEditor,[data-goal-reset],[data-ps-goal-reset]').forEach(node => node.remove());
    // Goal editors carry labels outside the input itself; remove the entire editor.
    source.querySelectorAll('.goalEditor,.psUploadGoalEditor,[data-goal-reset],[data-ps-goal-reset]').forEach(node => copies[originals.indexOf(node)]?.remove());
    clone.querySelectorAll('button').forEach(button => {const label=doc.createElement('span');label.style.cssText=button.style.cssText;label.append(...button.childNodes);button.replaceWith(label);});
    return clone;
  }
  async function open(workbook) {
    if (active) return;
    const table = doc.querySelector(workbook ? '#psUploadOverlay .psUploadTable' : '#scorecardWorkspace table');
    const rows = Array.from(table?.tBodies[0]?.rows || []), headers = Array.from(table?.tHead?.rows[0]?.cells || []);
    if (!rows.length || !headers.length || rows[0].cells.length !== headers.length || rows[0].cells[0]?.colSpan > 1) { root.alert('No scorecard rows to share. Adjust your filters or load data first.'); return; }
    active = true;
    const opener = doc.activeElement, dialog = doc.createElement('dialog');
    dialog.className = 'scorecardShareDialog';
    dialog.innerHTML = '<form method="dialog"><strong>Share Performance Scorecard</strong><button aria-label="Close sharing">Close</button></form><p>One compact image contains every row and enabled column in your current view. Paste it into Teams or Outlook.</p><div class="shareActions"><button type="button" data-share="copy">Copy Full Scorecard</button><button type="button" data-share="png">Save PNG</button><button type="button" data-share="size" aria-pressed="false">Inspect full size</button><button type="button" data-share="pdf">Save PDF</button></div><p role="status" aria-live="polite">Preparing image…</p><div class="sharePreview"><img alt="Complete scorecard. You can also right-click to copy or save this image."></div>';
    doc.body.append(dialog); dialog.showModal();
    const status = dialog.querySelector('[role=status]'), img = dialog.querySelector('img');
    const representative = Math.max(0,headers.findIndex(cell => /representative|associate|agent|name/i.test(cell.textContent)));
    const visible = headers.map((cell,index)=>root.getComputedStyle(cell).display !== 'none' ? index : -1).filter(index=>index >= 0);
    const full = fullReport(rows.length,headers.length); full.columns = visible;
    const plan = pages(rows.length,headers.length,10,4,representative).map(page=>({...page,columns:page.columns.filter(i=>visible.includes(i))})).filter(page=>page.columns.length > 1 || visible.length === 1);
    const base = root.getComputedStyle(workbook ? doc.getElementById('psUploadOverlay') : doc.querySelector('.main'));
    const background = color(base.getPropertyValue('--panel').trim()) || '#ffffff', ink = color(base.color);
    const meta = doc.getElementById(workbook ? 'psUploadMeta' : 'workspaceMeta')?.textContent || '';
    const coach = doc.getElementById(workbook ? 'psUploadCoach' : 'coachSel');
    const context = [meta, coach?.selectedOptions[0]?.textContent, workbook ? doc.getElementById('psUploadDepartment')?.value : doc.getElementById('departmentSel')?.value, workbook ? doc.getElementById('psUploadSearch')?.value : doc.querySelector('#quickFilters .active')?.textContent].filter(Boolean).join(' · ');
    // Snapshot once so changing underlying data cannot change later PDF pages.
    const headCopies = headers.map(freeze), rowCopies = rows.map(row => Array.from(row.cells).map(freeze));
    let currentBlob, currentURL, imageWidth, closed = false, busy = false;
    const filename = `performance-scorecard-${new Date().toISOString().slice(0,10)}`;
    function lock(value) { busy = value; dialog.querySelectorAll('[data-share]').forEach(button => button.disabled = value); }
    async function capture(page) {
      await library('../vendor/html2canvas.min.js', () => !!root.html2canvas);
      await doc.fonts?.ready;
      const card = doc.createElement('section');
      card.dataset.shareCapture = 'true';
      const widths = page.columns.map(i=>i === representative ? 220 : Math.min(210,Math.max(88,...rows.map(row=>Math.ceil((row.cells[i]?.innerText || row.cells[i]?.textContent || '').split('\n').reduce((max,line)=>Math.max(max,line.length),0)*7+14)).slice(0,500))));
      const width = Math.max(480,widths.reduce((sum,value)=>sum+value,0)+24);
      card.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;padding:12px;box-sizing:border-box;background:${background};color:${ink};font:14px Arial,sans-serif;zoom:1;`;
      const title = doc.createElement('h2'); title.textContent = 'Performance Scorecard'; title.style.cssText = 'font:700 20px Arial;margin:0 0 5px';
      const subtitle = doc.createElement('p'); subtitle.textContent = context; subtitle.style.cssText = 'margin:0 0 8px;font:12px/1.3 Arial';
      // Give each cell its own border area, outside the padded text content.
      const exportTable = doc.createElement('table'); exportTable.style.cssText = 'width:100%;min-width:0;table-layout:auto;border-collapse:separate;border-spacing:0;font-size:14px';
      const cols = doc.createElement('colgroup'); widths.forEach(w=>{const col=doc.createElement('col');col.style.width=w+'px';cols.append(col);}); exportTable.append(cols);
      const head = exportTable.createTHead().insertRow();
      page.columns.forEach(i => {const cell = headCopies[i].cloneNode(true); cell.style.display='table-cell';cell.style.padding = '8px 10px';cell.style.whiteSpace='normal';cell.style.borderBottom='1px solid #a6b4c6'; head.append(cell);});
      const body = exportTable.createTBody();
      for (let r = page.start; r < page.end; r++) {
        const row = body.insertRow();
        page.columns.forEach(i => {const cell = rowCopies[r][i].cloneNode(true); if(i === representative) {cell.style.maxWidth='260px';cell.querySelectorAll('b,strong,span').forEach(node=>node.style.whiteSpace='normal');} cell.style.display='table-cell';cell.style.padding = '8px 10px';cell.style.borderBottom='1px solid #cbd5e1'; row.append(cell);});
      }
      const footer = doc.createElement('p'); footer.textContent = `Representatives ${page.start + 1}–${page.end} of ${rows.length} · Current filters, sort, columns and goals`;
      footer.style.cssText = 'margin:8px 0 0;font:12px Arial';
      card.append(title, subtitle, exportTable, footer); doc.body.append(card);
      try {
        const height = Math.ceil(card.getBoundingClientRect().height);
        const measuredWidth = Math.ceil(card.scrollWidth), scale = Math.min(2,32700 / Math.max(height,measuredWidth),Math.sqrt(64000000 / (height*measuredWidth)));
        if(scale < 1) throw new Error('The complete scorecard exceeds this browser’s image size limit. Reduce the selected representatives or columns and try again. No rows were omitted.');
        return await root.html2canvas(card, {scale, backgroundColor:background, logging:false, width:measuredWidth, height, windowWidth:measuredWidth,scrollX:0,scrollY:0, onclone: cloned => { const copy = cloned.querySelector('[data-share-capture]'); if(copy) copy.style.left = '0'; }});
      } finally {card.remove();}
    }
    async function prepare() {
      lock(true); currentBlob = null; status.textContent = 'Preparing full-color image…';
      try {
        const canvas = await capture(full), blob = await toBlob(canvas);
        if (closed) return;
        currentBlob = blob; imageWidth = canvas.width; canvas.width = canvas.height = 0; if(currentURL) URL.revokeObjectURL(currentURL); currentURL = URL.createObjectURL(blob); img.src = currentURL;
        status.textContent = `Ready · ${rows.length} representatives · ${visible.length} columns. Copy or save the complete image; inspect full size to read all details.`;
      } catch(error) {status.textContent = error.message;}
      finally {lock(false);}
    }
    dialog.addEventListener('click', async event => {
      const action = event.target.closest('[data-share]')?.dataset.share;
      if (!action || busy) return;
      if (action === 'size') { const expanded=dialog.classList.toggle('shareFullSize'); img.style.width=expanded ? imageWidth+'px' : ''; event.target.textContent=expanded ? 'Fit preview' : 'Inspect full size';event.target.setAttribute('aria-pressed',String(expanded));return; }
      if (action !== 'pdf' && !currentBlob) {await prepare(); return;}
      lock(true);
      try {
        if(action === 'copy') {
          if(!root.isSecureContext || !root.ClipboardItem || !root.navigator.clipboard?.write) throw new Error('Image clipboard is unavailable here.');
          await root.navigator.clipboard.write([new root.ClipboardItem({'image/png': currentBlob})]);
          status.textContent = 'Image copied. Paste it into your Teams chat.';
        } else if(action === 'png') {
          download(currentBlob, `${filename}.png`); status.textContent = 'PNG saved.';
        } else {
          await library('../vendor/jspdf.umd.min.js', () => !!root.jspdf?.jsPDF);
          let pdf;
          for(let i = 0; i < plan.length; i++) {
            if(closed) return;
            status.textContent = `Building PDF section ${i+1} of ${plan.length}…`;
            const canvas = await capture(plan[i]), width = 810, height = canvas.height / canvas.width * width, orientation = width >= height ? 'landscape' : 'portrait';
            if(!pdf) pdf = new root.jspdf.jsPDF({orientation, unit:'pt', format:[width,height], compress:true});
            else pdf.addPage([width,height], orientation);
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height, undefined, 'FAST');
            canvas.width = canvas.height = 0;
          }
          if(!closed) {pdf.save(`${filename}.pdf`); status.textContent = 'Full-color PDF saved. Attach it in Teams.';}
        }
      } catch(error) {status.textContent = action === 'copy' ? `${error.message} Use Save PNG or right-click the image to copy it.` : error.message;}
      finally {lock(false);}
    });
    dialog.addEventListener('close', () => {closed = true; active = false; if(currentURL) URL.revokeObjectURL(currentURL); dialog.remove(); opener?.focus();}, {once:true});
    await prepare();
  }
  root.CoachToolsScorecardSharing = {open,fullReport};
})(typeof window === 'undefined' ? globalThis : window);
