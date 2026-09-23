/* Readable, bounded exports shared by stored-data and live-workbook scorecards. */
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
  if (typeof module !== 'undefined') module.exports = {pages};
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
      for (const key of ['display','padding','margin','font-family','font-weight','font-style','text-align','vertical-align','border-radius','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style']) copy.style.setProperty(key, style.getPropertyValue(key));
      for (const key of ['color','background-color','border-top-color','border-right-color','border-bottom-color','border-left-color']) copy.style.setProperty(key, color(style.getPropertyValue(key)));
      copy.style.fontSize = `${Math.max(12, parseFloat(style.fontSize) || 12)}px`;
      copy.style.lineHeight = '1.4'; copy.style.whiteSpace = 'normal'; copy.style.overflowWrap = 'anywhere';
      copy.style.position = 'static'; copy.style.maxWidth = '100%'; copy.style.minWidth = '0';
      copy.style.letterSpacing = 'normal'; copy.style.boxShadow = 'none';
      if (node.matches('.goalMet,.psGoalMet,.goalMiss,.psGoalMiss')) {
        const goalColor = color(style.getPropertyValue(node.matches('.goalMet,.psGoalMet') ? '--good' : '--bad').trim());
        copy.style.borderLeft = `3px solid ${goalColor}`;
      }
      if (node.matches('button')) { copy.style.border = '0'; copy.style.background = 'transparent'; }
    });
    clone.querySelectorAll('input,select,textarea,.goalEditor,[data-goal-reset]').forEach(node => node.remove());
    // Goal editors carry labels outside the input itself; remove the entire editor.
    source.querySelectorAll('.goalEditor').forEach(node => copies[originals.indexOf(node)]?.remove());
    return clone;
  }
  async function open(workbook) {
    if (active) return;
    const table = doc.querySelector(workbook ? '#psUploadOverlay .psUploadTable' : '#scorecardWorkspace table');
    const rows = Array.from(table?.tBodies[0]?.rows || []), headers = Array.from(table?.tHead?.rows[0]?.cells || []);
    if (!rows.length || !headers.length || rows[0].cells.length !== headers.length) { root.alert('No scorecard rows to share. Adjust your filters or load data first.'); return; }
    active = true;
    const opener = doc.activeElement, dialog = doc.createElement('dialog');
    dialog.className = 'scorecardShareDialog';
    dialog.innerHTML = '<form method="dialog"><strong>Share Performance Scorecard</strong><button aria-label="Close sharing">Close</button></form><p>Copy an image, then paste it into Teams. PDF files can be attached manually. Each section repeats the representative and column headings.</p><div class="shareActions"><label>Section <select aria-label="Scorecard section"></select></label><button type="button" data-share="copy">Copy image</button><button type="button" data-share="png">Save PNG</button><button type="button" data-share="pdf">Save all as PDF</button></div><p role="status" aria-live="polite">Preparing image…</p><img alt="Selected scorecard section. You can also right-click to copy or save this image.">';
    doc.body.append(dialog); dialog.showModal();
    const status = dialog.querySelector('[role=status]'), select = dialog.querySelector('select'), img = dialog.querySelector('img');
    const representative = headers.findIndex(cell => /representative|associate|agent|name/i.test(cell.textContent));
    const plan = pages(rows.length, headers.length, 10, 4, Math.max(0, representative));
    plan.forEach((page, index) => { const option = doc.createElement('option'); option.value = index; option.textContent = `${index + 1} / ${plan.length} · rows ${page.start + 1}–${page.end} · ${page.columns.slice(1).map(i => headers[i].textContent.trim().split('\n')[0]).join(', ')}`; select.append(option); });
    const base = root.getComputedStyle(workbook ? doc.getElementById('psUploadOverlay') : doc.querySelector('.main'));
    const background = color(base.getPropertyValue('--panel').trim()) || '#ffffff', ink = color(base.color);
    const meta = doc.getElementById(workbook ? 'psUploadMeta' : 'workspaceMeta')?.textContent || '';
    const coach = doc.getElementById(workbook ? 'psUploadCoach' : 'coachSel');
    const context = [meta, coach?.selectedOptions[0]?.textContent, doc.querySelector('#quickFilters .active')?.textContent].filter(Boolean).join(' · ');
    // Snapshot once so changing underlying data cannot change later PDF pages.
    const headCopies = headers.map(freeze), rowCopies = rows.map(row => Array.from(row.cells).map(freeze));
    let currentBlob, currentURL, closed = false, busy = false;
    const filename = `performance-scorecard-${new Date().toISOString().slice(0,10)}`;
    function lock(value) { busy = value; select.disabled = value; dialog.querySelectorAll('[data-share]').forEach(button => button.disabled = value); }
    async function capture(index) {
      await library('../vendor/html2canvas.min.js', () => !!root.html2canvas);
      await doc.fonts?.ready;
      const page = plan[index], card = doc.createElement('section');
      card.dataset.shareCapture = 'true';
      card.style.cssText = `position:fixed;left:-20000px;top:0;width:1080px;padding:20px;box-sizing:border-box;background:${background};color:${ink};font:14px Arial,sans-serif;zoom:1;`;
      const title = doc.createElement('h2'); title.textContent = 'Performance Scorecard'; title.style.cssText = 'font:700 24px Arial;margin:0 0 8px';
      const subtitle = doc.createElement('p'); subtitle.textContent = context; subtitle.style.margin = '0 0 12px';
      const exportTable = doc.createElement('table'); exportTable.style.cssText = 'width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;font-size:14px';
      const head = exportTable.createTHead().insertRow();
      page.columns.forEach(i => {const cell = headCopies[i].cloneNode(true); cell.style.padding = '10px'; head.append(cell);});
      const body = exportTable.createTBody();
      for (let r = page.start; r < page.end; r++) {
        const row = body.insertRow();
        page.columns.forEach(i => {const cell = rowCopies[r][i].cloneNode(true); cell.style.padding = '9px 10px'; row.append(cell);});
      }
      const footer = doc.createElement('p'); footer.textContent = `Section ${index + 1} of ${plan.length} · Representatives ${page.start + 1}–${page.end} of ${rows.length} · Current filters, sort, columns and goals · ${new Date().toLocaleDateString()}`;
      footer.style.cssText = 'margin:12px 0 0;font:12px Arial';
      card.append(title, subtitle, exportTable, footer); doc.body.append(card);
      try {
        const height = Math.ceil(card.getBoundingClientRect().height);
        if (height > 7000) throw new Error('This section is too tall. Use Basic display or fewer columns before sharing.');
        return await root.html2canvas(card, {scale:2, backgroundColor:background, logging:false, width:1080, height, windowWidth:1200, onclone: cloned => { const copy = cloned.querySelector('[data-share-capture]'); if(copy) copy.style.left = '0'; }});
      } finally {card.remove();}
    }
    async function prepare() {
      lock(true); currentBlob = null; status.textContent = 'Preparing full-color image…';
      try {
        const canvas = await capture(Number(select.value)), blob = await toBlob(canvas);
        if (closed) return;
        currentBlob = blob; if(currentURL) URL.revokeObjectURL(currentURL); currentURL = URL.createObjectURL(blob); img.src = currentURL;
        status.textContent = 'Ready. Copy image or save this section. PDF includes every section.';
      } catch(error) {status.textContent = error.message;}
      finally {lock(false);}
    }
    select.addEventListener('change', prepare);
    dialog.addEventListener('click', async event => {
      const action = event.target.closest('[data-share]')?.dataset.share;
      if (!action || busy) return;
      if (action !== 'pdf' && !currentBlob) {await prepare(); return;}
      lock(true);
      try {
        if(action === 'copy') {
          if(!root.isSecureContext || !root.ClipboardItem || !root.navigator.clipboard?.write) throw new Error('Image clipboard is unavailable here. Use Save PNG, or right-click the image and choose Copy image.');
          await root.navigator.clipboard.write([new root.ClipboardItem({'image/png': currentBlob})]);
          status.textContent = 'Image copied. Paste it into your Teams chat.';
        } else if(action === 'png') {
          download(currentBlob, `${filename}-section-${Number(select.value)+1}.png`); status.textContent = 'PNG saved.';
        } else {
          await library('../vendor/jspdf.umd.min.js', () => !!root.jspdf?.jsPDF);
          let pdf;
          for(let i = 0; i < plan.length; i++) {
            if(closed) return;
            status.textContent = `Building PDF section ${i+1} of ${plan.length}…`;
            const canvas = await capture(i), width = 810, height = canvas.height / canvas.width * width, orientation = width >= height ? 'landscape' : 'portrait';
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
  root.CoachToolsScorecardSharing = {open};
})(typeof window === 'undefined' ? globalThis : window);
