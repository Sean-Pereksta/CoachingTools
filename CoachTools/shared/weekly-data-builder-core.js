/* Weekly Data Builder v1.1 — dependency-free transformation engine. */
(function weeklyFactory(root) {
  'use strict';
  const text = v => v == null ? '' : String(v);
  const tidy = v => text(v).replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
  const norm = v => tidy(v).normalize('NFKC').toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ');
  const blankRow = row => !row.some(v => tidy(v));
  const countFmt = n => Number(n).toLocaleString('en-US');
  function nameKey(v) {
    let n = tidy(v).normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-');
    if ((n.match(/,/g) || []).length === 1) { const a = n.split(','); if (a[0].trim() && a[1].trim()) n = a[1].trim() + ' ' + a[0].trim(); }
    return n.replace(/\s+/g, ' ');
  }
  function decodeText(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let encoding = 'utf-8', offset = 0;
    if (b[0] === 255 && b[1] === 254) { encoding = 'utf-16le'; offset = 2; }
    else if (b[0] === 254 && b[1] === 255) { encoding = 'utf-16be'; offset = 2; }
    else if (b[0] === 239 && b[1] === 187 && b[2] === 191) offset = 3;
    else {
      let even = 0, odd = 0, n = Math.min(b.length, 4000);
      for (let i = 0; i < n; i++) if (b[i] === 0) (i % 2 ? odd++ : even++);
      if (odd > n / 5) encoding = 'utf-16le'; else if (even > n / 5) encoding = 'utf-16be';
    }
    let s;
    try { s = new TextDecoder(encoding, { fatal: true }).decode(b.subarray(offset)); }
    catch (_) { encoding = 'windows-1252'; s = new TextDecoder(encoding).decode(b.subarray(offset)); }
    return { text: s.replace(/^\uFEFF/, ''), encoding };
  }
  function delimiterOf(s) {
    const directive = /^sep=(.)\r?\n/i.exec(s); if (directive) return directive[1];
    const delimiters = ['\t', ',', ';', '|'];
    let best = ',', bestScore = -1;
    for (const d of delimiters) {
      let inQuote = false, width = 1, counts = [], fieldStart = true;
      for (let i = 0; i < s.length && counts.length < 30; i++) {
        const ch = s[i];
        if (ch === '"') { if (inQuote && s[i + 1] === '"') i++; else if (inQuote || fieldStart) inQuote = !inQuote; }
        else if (!inQuote && ch === d) { width++; fieldStart = true; continue; }
        else if (!inQuote && (ch === '\n' || ch === '\r')) { if (width > 1) counts.push(width); width = 1; fieldStart = true; if (ch === '\r' && s[i+1] === '\n') i++; continue; }
        fieldStart = false;
      }
      if (!counts.length && width > 1) counts.push(width);
      const freq = new Map(); counts.forEach(x => freq.set(x, (freq.get(x) || 0) + 1));
      let score = 0; for (const [w, n] of freq) score = Math.max(score, n * 10 + Math.min(w, 100) / 10);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
  function parseDelimited(s, delim) {
    s = text(s).replace(/^\uFEFF/, ''); delim = delim || delimiterOf(s);
    s = s.replace(/^sep=.\r?\n/i, '');
    const rows = []; let row = [], field = '', quoted = false, afterQuote = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
        else field += ch;
      } else if (ch === '"' && field === '' && !afterQuote) quoted = true;
      else if (ch === delim) { row.push(field); field = ''; afterQuote = false; }
      else if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; afterQuote = false; if (ch === '\r' && s[i + 1] === '\n') i++; }
      else if (afterQuote && /[ \t]/.test(ch)) { /* Tolerate padding after a quoted field. */ }
      else { if (afterQuote) throw new Error('Unexpected text after a quoted field near row ' + (rows.length + 1) + '. Save a fresh CSV export.'); field += ch; }
    }
    if (quoted) throw new Error('An opening quote has no closing quote in this file. Save a fresh CSV export.');
    if (field !== '' || row.length || afterQuote) { row.push(field); rows.push(row); }
    return { rows, delimiter: delim };
  }
  function dimKey(h) {
    h = norm(h);
    if (['name','employee name','employee full name','associate name','rep name','representative name','csr name','agent name','full name','agent','rep','representative','employee','associate','csr','employee fullname'].includes(h)) return 'name';
    if (['sheet','coach','coach name','supervisor','supervisor name','team coach','team leader','employee supervisor name','employee immediate supervisor name'].includes(h)) return 'coach';
    if (['manager','manager name','manger','manger name','employee manager name','employee second level supervisor name'].includes(h)) return 'manager';
    if (['date','report date','publication date','publish date','week','week ending','reporting period','period','date range','fiscal week','fiscal period'].includes(h)) return 'date';
    return '';
  }
  function segmentOf(h) {
    const n = norm(h);
    if (/\bcommercial\b/.test(n)) return 'commercial';
    if (/\bconsumer\b/.test(n)) return 'consumer';
    if (/\binsurance\b/.test(n)) return 'insurance';
    if (/\b(total|overall)\b/.test(n)) return 'total';
    return '';
  }
  function metricOf(h, segment) {
    let n = norm(h), seg = segmentOf(n) || segment || '';
    if (!n) return '';
    const wiper = /\bwipers?\b/.test(n);
    if (wiper || ['accepted','offered','asked','jobs','count'].includes(n)) {
      if (/\b(offered|offers|asked|jobs|job)\b/.test(n)) return 'wiper.offered';
      if (/\b(accepted|accepts|count|counts|sold|sales)\b/.test(n)) return 'wiper.accepted';
      if (/\b(rate|conversion|attach)\b/.test(n)) return 'wiper.rate';
    }
    if (/\bacd calls?\b/.test(n)) return 'acd_calls';
    if (/\binbound calls? per hour\b/.test(n)) return 'inbound_calls_per_hour';
    if (n === '% available' || n === 'percent available' || n === 'available %' || n === 'availability') return 'available_rate';
    n = n.replace(/\b(commercial|consumer|insurance|total|overall)\b/g, '').trim();
    if (/^(opportunities|opportunity|opps|opportunity count)$/.test(n)) return (seg || 'total') + '.opportunities';
    if (/^(appointments|appointment|appts|appts booked|appointment count)$/.test(n)) return (seg || 'total') + '.appointments';
    if (/^(appt|appts|appointment|appointments) (rate|%)$/.test(n) || /^appointment conversion rate$/.test(n)) return (seg || 'total') + '.appointment_rate';
    if (/^(opportunity|opportunities|opp) (rate|%)$/.test(n)) return (seg || 'total') + '.opportunity_rate';
    return '';
  }
  function aliasRank(h, key) {
    const n = norm(h);
    if (key === 'wiper.accepted') return /\baccepted\b/.test(n) ? 100 : /\bcount\b/.test(n) ? 50 : 30;
    if (key === 'wiper.offered') return /\boffered\b/.test(n) ? 100 : /\basked\b/.test(n) ? 80 : 50;
    return 100;
  }
  function colLabel(i) { let s = ''; for (i++; i; i = Math.floor((i-1)/26)) s = String.fromCharCode(65+(i-1)%26)+s; return s; }
  function describeColumns(rows, h) {
    const width = Math.max(0, ...rows.slice(Math.max(0,h-3),h+2).map(r=>r.length));
    const contexts = Array(width).fill('');
    for (let r = Math.max(0,h-3); r < h; r++) {
      const found = (rows[r] || []).some(c => /^(commercial|consumer|insurance|total|overall)$/i.test(tidy(c)));
      if (!found) continue;
      let current = '';
      for (let c=0;c<width;c++) { const t=tidy(rows[r][c]); if (/^(commercial|consumer|insurance|total|overall)$/i.test(t)) current=segmentOf(t); else if(t) current=''; if(current) contexts[c]=current; }
    }
    return Array.from({length:width},(_,i)=>{
      const raw=tidy((rows[h]||[])[i]), dim=dimKey(raw), key=dim ? '' : metricOf(raw,contexts[i]);
      const label = raw ? (contexts[i] && key && !segmentOf(raw) && key.startsWith(contexts[i]+'.') ? contexts[i][0].toUpperCase()+contexts[i].slice(1)+' · '+raw : raw) : 'Column '+colLabel(i);
      return {index:i,raw,label,dim,key,rank:aliasRank(raw,key)};
    });
  }
  function detectHeader(rows, kind) {
    let best = {row: -1, score: 0};
    for (let h=0;h<Math.min(rows.length,60);h++) {
      const cols=describeColumns(rows,h); let score=0;
      if(kind==='weekly') { const dims=new Set(cols.map(c=>c.dim)); score=dims.has('date')&&dims.has('name')&&dims.has('coach') ? 100+cols.filter(c=>c.key).length : 0; }
      else if(kind==='appointments') {
        const metrics=cols.filter(c=>/\.(opportunities|appointments|appointment_rate|opportunity_rate)$/.test(c.key));
        score=metrics.length>=2 ? metrics.length*10+cols.filter(c=>c.dim).length : 0;
      } else { const metrics=cols.filter(c=>c.key.startsWith('wiper.')); score=metrics.length ? metrics.length*10+cols.filter(c=>c.dim==='name').length*5 : 0; }
      if(score>best.score) best={row:h,score};
    }
    return best.row;
  }
  function analyze(rows,kind,overrides={}) {
    if(!rows.length || rows.every(blankRow)) throw new Error('This file is empty.');
    let h = Number.isInteger(overrides.headerRow) ? overrides.headerRow : detectHeader(rows,kind);
    if(h<0 || h>=rows.length) throw new Error(kind==='weekly' ? 'Could not find the weekly header. It must include Date, Sheet (or Coach), and Name.' : 'Could not detect the report header. Use “Source columns” to select the header row and identity columns.');
    const cols=describeColumns(rows,h), notices=[];
    const dims={}; for(const d of ['name','coach','manager','date']) dims[d]=cols.find(c=>c.dim===d)?.index ?? -1;
    const firstMetric=cols.find(c=>c.key)?.index ?? -1;
    if(kind==='appointments' && dims.name<0 && firstMetric===3 && cols.slice(0,3).every(c=>!c.raw)) {
      dims.coach=0; dims.name=1; dims.date=2;
      notices.push('Unlabeled appointment columns detected: A = coach, B = representative, C = report period.');
    }
    if(kind==='appointments' && dims.name<0 && firstMetric===4 && cols.slice(0,4).every(c=>!c.raw)) {
      dims.manager=0; dims.coach=1; dims.name=2; dims.date=3;
      notices.push('Unlabeled appointment columns detected: A = manager, B = coach, C = representative, D = report period.');
    }
    for(const d of ['name','coach','manager','date']) if(Number.isInteger(overrides[d])) dims[d]=overrides[d];
    const keys=new Map();
    for(const c of cols) if(c.key && !Object.values(dims).includes(c.index)) { const prev=keys.get(c.key); if(!prev || c.rank>prev.rank) keys.set(c.key,c); }
    if(dims.name<0) throw new Error('The representative name column is not identified. Open “Source columns” and choose the name column.');
    if(kind==='weekly' && (dims.coach<0 || dims.date<0)) throw new Error('The previous weekly file needs Date, Sheet (or Coach), and Name columns.');
    if(kind==='appointments' && dims.coach<0) notices.push('No coach column is selected. New Sheet values will be blank until a coach column is selected.');
    const periods = dims.date < 0 ? [] : [...new Set(rows.slice(h+1).filter(r=>tidy(r[dims.name])&&!isSummary(r[dims.name])).map(r=>tidy(r[dims.date])).filter(Boolean))];
    return {kind,headerRow:h,columns:cols,dims,keys,periods,notices};
  }
  function isSummary(v) { return /^(grand total|total|subtotal|overall total|all reps|all representatives|all employees|all agents)(\s*[:(].*)?$/i.test(tidy(v)) || /^subtotal\b/i.test(tidy(v)); }
  function parseStat(v,key) {
    const original=tidy(v); if(!original || /^(\*+|[-–—]+|n\/?a|null|none|#n\/a)$/i.test(original)) return {value:'',invalid:false};
    let s=original.replace(/,/g,'').replace(/\s+/g,'');
    const rate=/rate$|per_hour$/.test(key), percent=s.endsWith('%');
    if(percent) s=s.slice(0,-1);
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return {value:'',invalid:true};
    let n=Number(s);
    if(!Number.isFinite(n) || (!rate && (percent || n<0 || !Number.isSafeInteger(n)))) return {value:'',invalid:true};
    if(percent) n/=100;
    return {value:String(Number(n.toPrecision(14))),invalid:false};
  }
  function sourceRecords(rows,analysis,opts={}) {
    if(analysis.kind!=='weekly' && analysis.periods.length>1 && !opts.period) throw new Error('Choose one source period for the '+analysis.kind+' report before building weekly statistics.');
    const directory=root.CoachToolsStatsDirectory;
    if(directory) rows=directory.rewriteRows(rows,analysis).rows;
    const groups=new Map(),skipped=[],invalid=[],conflicts=[]; let coachCarry='';
    const cols=analysis.columns, keyForIndex=new Map(cols.filter(c=>c.key).map(c=>[c.index,c.key]));
    for(let i=analysis.headerRow+1;i<rows.length;i++) {
      const row=rows[i]; if(blankRow(row)) continue;
      const name=tidy(row[analysis.dims.name]); let coach=analysis.dims.coach<0 ? '' : tidy(row[analysis.dims.coach]);
      if(coach) coachCarry=coach; else if(opts.carryCoach) coach=coachCarry;
      if(!name || isSummary(name) || ['*','-'].includes(name)) { skipped.push({kind:'skipped',name:name||'(no name)',source:analysis.kind,row:i+1,message:!name?'No representative name.':'Summary or placeholder row.'}); continue; }
      if(nameKey(name)===nameKey(cols[analysis.dims.name]?.raw) && cols.filter(c=>c.key).some(c=>norm(row[c.index])===norm(c.raw))) { skipped.push({kind:'skipped',name,source:analysis.kind,row:i+1,message:'Repeated header row.'}); continue; }
      const period=analysis.dims.date<0 ? '' : tidy(row[analysis.dims.date]);
      if(opts.period && period!==opts.period) continue;
      const nk=nameKey(name), ck=nameKey(coach), identity=nk+'\u001f'+(analysis.kind==='appointments'?ck:(analysis.dims.coach>=0?ck:''));
      const cells=cols.map(c=>{
        if(!c.key || Object.values(analysis.dims).includes(c.index)) return tidy(row[c.index]);
        const p=parseStat(row[c.index],c.key);
        if(p.invalid) invalid.push({kind:'invalid',name,source:analysis.kind,row:i+1,message:c.label+': “'+text(row[c.index])+'” is not a valid statistic; left blank.'});
        return p.value;
      });
      let g=groups.get(identity);
      if(!g) {g={id:analysis.kind+':'+identity,name,nameKey:nk,coach:ck,displayCoach:coach,manager:analysis.dims.manager>=0?tidy(row[analysis.dims.manager]):(directory?.managerFor(coach)||''),candidates:[],signatures:new Set(),rows:[],cells:[]};groups.set(identity,g);}
      const signature=JSON.stringify(cells); if(g.signatures.has(signature)) {skipped.push({kind:'duplicate',name,source:analysis.kind,row:i+1,message:'Exact duplicate source record ignored.'});continue;}
      g.signatures.add(signature);g.candidates.push({row:i+1,cells,period});g.rows.push(i+1);
    }
    for(const g of groups.values()) {
      const chosen = opts.choices && opts.choices[g.id];
      const selected=g.candidates.find(c=>c.row===Number(chosen));
      if(selected) {g.cells=selected.cells.slice();g.selectedRow=selected.row;}
      else {
        const differing=[];
        g.cells=cols.map(c=>{
          const vals=[...new Set(g.candidates.map(r=>r.cells[c.index]).filter(v=>v!==''))];
          if(vals.length>1 && !Object.values(analysis.dims).includes(c.index)) {differing.push(c.label);return '';}
          return vals[0]||'';
        });
        if(differing.length) conflicts.push({kind:'conflict',name:g.name,source:analysis.kind,row:g.rows.join(', '),groupId:g.id,candidates:g.candidates,message:'Multiple source records disagree in '+differing.join(', ')+'. Conflicting fields are blank; choose one source row to resolve.'});
      }
      delete g.signatures;
    }
    return {records:[...groups.values()],skipped,invalid,conflicts};
  }
  function dateInfo(iso) {
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text(iso)); if(!m) throw new Error('Enter a publication date.');
    const y=+m[1],mo=+m[2],d=+m[3],dt=new Date(Date.UTC(y,mo-1,d));
    if(y<1900 || y>9999 || dt.getUTCFullYear()!==y || dt.getUTCMonth()!==mo-1 || dt.getUTCDate()!==d) throw new Error('Enter a valid publication date.');
    return {iso,us:mo+'/'+d+'/'+y,md:mo+'/'+d};
  }
  function comparableDate(v) {
    const t=tidy(v);const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);if(m) return m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');
    return /^\d{4}-\d{2}-\d{2}(?:T|\s|$)/.test(t)?t.slice(0,10):t;
  }
  function safeNewText(v,protections) { const s=text(v);if(/^[\s]*[=+@-]/.test(s) || /^[\t\r]/.test(s)){protections.count++;return "'"+s;}return s; }
  function dateMatches(v,publication) {
    if(comparableDate(v)===publication.iso)return true;
    const t=tidy(v),m=/^(\d{1,2})\/(\d{1,2})$/.exec(t);
    return !!m && (+m[1])+'/'+ (+m[2])===publication.md;
  }
  function representativeKey(value) { return nameKey(root.CoachToolsStatsDirectory?.resolve(value,'name') || value); }
  function coachKey(value) { return nameKey(root.CoachToolsStatsDirectory?.resolve(value,'coach') || value); }
  function assembleModify(input) {
    const options=input.options||{},publication=dateInfo(input.date),warnings=[],review=[];
    const weeklyRows=input.weeklyRows||[], appointmentRows=input.appointmentRows||[], wiperRows=input.wiperRows||[];
    const hasAppointments=appointmentRows.some(r=>!blankRow(r)),hasWipers=wiperRows.some(r=>!blankRow(r));
    if(!hasAppointments&&!hasWipers)throw new Error('Modify mode needs at least one source report: appointments or wipers.');
    const ta=analyze(weeklyRows,'weekly',options.weeklyColumns||{}),aa=hasAppointments?analyze(appointmentRows,'appointments',options.appointmentColumns||{}):null,wa=hasWipers?analyze(wiperRows,'wipers',options.wiperColumns||{}):null;
    const empty=()=>({records:[],conflicts:[],invalid:[],skipped:[]});
    const ap=aa?sourceRecords(appointmentRows,aa,{period:options.appointmentPeriod,carryCoach:options.carryCoach,choices:options.sourceChoices}):empty();
    const wi=wa?sourceRecords(wiperRows,wa,{period:options.wiperPeriod,choices:options.sourceChoices}):empty();
    if(aa&&!ap.records.length)warnings.push('No named appointment records were found for the selected source period.');
    if(wa&&!wi.records.length)warnings.push('No named wiper records were found for the selected source period.');
    const header=weeklyRows[ta.headerRow].map(text),width=header.length,headerNames=header.filter(tidy).map(norm);
    if(new Set(headerNames).size<headerNames.length)throw new Error('The previous weekly file has duplicate column headers. Give each column a unique name before exporting.');
    let last=weeklyRows.length-1;while(last>ta.headerRow&&blankRow(weeklyRows[last]))last--;
    const previousRows=weeklyRows.slice(0,last+1).map(r=>r.map(text));
    if(previousRows.slice(ta.headerRow+1).some(r=>r.slice(width).some(v=>tidy(v))))throw new Error('Existing data extends beyond the weekly header. Add the missing column header before continuing.');
    const targetIndexes=[];for(let i=ta.headerRow+1;i<previousRows.length;i++)if(dateMatches(previousRows[i][ta.dims.date],publication))targetIndexes.push(i);
    if(!targetIndexes.length)throw new Error('No rows in the weekly file match '+publication.us+'. Use Add mode if this date does not exist yet.');
    const protectedText={count:0},activeTargets=new Map();for(const c of ta.columns)if(c.key){const old=activeTargets.get(c.key);if(!old||c.rank>old.rank)activeTargets.set(c.key,c);}
    const mapping=header.map((h,i)=>{
      const col=ta.columns[i],dim=Object.entries(ta.dims).find(([,v])=>v===i)?.[0];
      if(dim==='date'||dim==='name')return {index:i,target:h,dimension:dim,status:'fixed',description:dim==='date'?'Matched selected date; existing Date is not rewritten.':'Matched representative name; existing Name is not rewritten.'};
      if(dim==='coach'||dim==='manager')return {index:i,target:h,dimension:dim,source:aa?'appointments':'',status:aa?'mapped':'blank',description:aa?'Appointment '+dim+' may update this identity column.':'No appointment file supplied; this identity column stays unchanged.'};
      if(col.key&&activeTargets.get(col.key)?.index!==i)return {index:i,target:h,key:col.key,status:'blank',description:'A more explicit destination column is used for this statistic.'};
      let src=null,source='';
      if(col.key){if(col.key.startsWith('wiper.')){if(wa){src=wa.keys.get(col.key);source='wipers';}}else if(aa){src=aa.keys.get(col.key);source='appointments';}}
      else if(tidy(h)){
        if(aa){src=aa.columns.find(c=>!c.dim&&!Object.values(aa.dims).includes(c.index)&&c.raw&&norm(c.raw)===norm(h));if(src)source='appointments';}
        if(!src&&wa){src=wa.columns.find(c=>!c.dim&&!Object.values(wa.dims).includes(c.index)&&c.raw&&norm(c.raw)===norm(h));if(src)source='wipers';}
      }
      let percentOutput=false;if(col.key&&/rate$/.test(col.key)){const vals=previousRows.slice(ta.headerRow+1).map(r=>tidy(r[i])).filter(Boolean).slice(-300);percentOutput=vals.length>0&&vals.filter(v=>v.endsWith('%')).length>vals.length/2;}
      return {index:i,target:h,key:col.key||'',source:src?source:'',sourceIndex:src?.index,sourceLabel:src?.label||'',status:src?'mapped':'blank',percentOutput,description:src?source+' · '+src.label+' → modify only when a source value is present':'No supplied source field; existing values stay unchanged.'};
    });
    review.push(...ap.conflicts,...wi.conflicts,...ap.invalid,...wi.invalid,...ap.skipped,...wi.skipped);
    const apByName=new Map(),wiByName=new Map();
    for(const a of ap.records){if(!apByName.has(a.nameKey))apByName.set(a.nameKey,[]);apByName.get(a.nameKey).push(a);}
    for(const w of wi.records){if(!wiByName.has(w.nameKey))wiByName.set(w.nameKey,[]);wiByName.get(w.nameKey).push(w);}
    const existingTargetNames=new Set(targetIndexes.map(i=>representativeKey(previousRows[i][ta.dims.name])).filter(Boolean));
    const working=previousRows.map(r=>r.slice()),modifiedRecords=[];let matchedRows=0,unchangedMatches=0,modifiedCells=0;
    const ambiguousKeys=new Set();
    const targetNameCounts=new Map();
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
    function sourceValue(m,a,w){
      if(m.dimension==='coach')return a&&a.coach?safeNewText(a.displayCoach||a.coach,protectedText):'';
      if(m.dimension==='manager')return a?.manager?safeNewText(a.manager,protectedText):'';
      if(m.dimension)return '';
      if(m.status!=='mapped')return '';
      const record=m.source==='appointments'?a:w;if(!record)return '';
      let v=record.cells[m.sourceIndex]??'';if(v==='')return '';
      if(m.percentOutput&&v!=='')v=String(Number((Number(v)*100).toPrecision(14)))+'%';
      return m.key?v:safeNewText(v,protectedText);
    }
    for(const i of targetIndexes){
      const row=working[i],name=tidy(row[ta.dims.name]),nk=representativeKey(name);if(!nk)continue;
      const a=aa?recordFor(apByName,row,nk,i+1,'appointments'):null,w=wa?recordFor(wiByName,row,nk,i+1,'wipers',a?.coach):null;
      if(!a&&!w)continue;matchedRows++;
      const values=row.slice();while(values.length<width)values.push('');const changes=[];
      for(const m of mapping){const nv=sourceValue(m,a,w);if(nv==='')continue;const ov=text(values[m.index]??'');if(ov!==nv){values[m.index]=nv;changes.push({index:m.index,column:m.target||('Column '+colLabel(m.index)),oldValue:ov,newValue:nv,source:m.source||'appointments'});}}
      if(changes.length){working[i]=values;modifiedCells+=changes.length;modifiedRecords.push({values,name,coach:ta.dims.coach>=0?tidy(values[ta.dims.coach]):'',kind:'modified',rowNumber:i+1,changes});}else unchangedMatches++;
    }
    const newRecords=[],targetDateValue=text(previousRows[targetIndexes[0]][ta.dims.date])||publication.us;
    if(options.addNew){
      const pairedWipers=new Set(),collator=new Intl.Collator('en',{sensitivity:'base',numeric:true});
      function makeNew(a,w){
        const name=a?.name||w?.name||'',coach=a?.displayCoach||a?.coach||w?.displayCoach||w?.coach||'',values=Array(width).fill(''),changes=[];
        for(const m of mapping){let v='';if(m.dimension==='date')v=targetDateValue;else if(m.dimension==='name')v=safeNewText(name,protectedText);else if(m.dimension==='coach')v=safeNewText(coach,protectedText);else if(m.dimension==='manager')v=safeNewText(a?.manager||w?.manager||'',protectedText);else v=sourceValue(m,a,w);values[m.index]=v;if(v!==''&&!m.dimension)changes.push({index:m.index,column:m.target||('Column '+colLabel(m.index)),oldValue:'',newValue:v,source:m.source||''});}
        newRecords.push({values,name,coach,kind:'modify-new',changes,appointmentRows:a?.rows||[],wiperRows:w?.rows||[]});
      }
      const aps=ap.records.filter(a=>!existingTargetNames.has(a.nameKey)).sort((a,b)=>collator.compare(a.coach,b.coach)||collator.compare(a.name,b.name));
      for(const a of aps){const ws=wiByName.get(a.nameKey)||[];const remaining=ws.filter(x=>!pairedWipers.has(x.id)),exact=remaining.filter(x=>x.coach===a.coach);const w=exact.length===1?exact[0]:(remaining.length===1&&aps.filter(x=>x.nameKey===a.nameKey).length===1?remaining[0]:null);if(w)pairedWipers.add(w.id);makeNew(a,w);}
      const wipers=wi.records.filter(w=>!existingTargetNames.has(w.nameKey)&&!pairedWipers.has(w.id)).sort((a,b)=>collator.compare(a.name,b.name));for(const w of wipers)makeNew(null,w);
    }
    sortNewRecordsByCoach(newRecords);
    const sourceMissing=[];
    for(const a of ap.records)if(!existingTargetNames.has(a.nameKey))sourceMissing.push({name:a.name,source:'appointments',row:a.rows.join(', ')});
    for(const w of wi.records)if(!existingTargetNames.has(w.nameKey)&&!sourceMissing.some(x=>nameKey(x.name)===w.nameKey))sourceMissing.push({name:w.name,source:'wipers',row:w.rows.join(', ')});
    if(!options.addNew)for(const x of sourceMissing)review.push({kind:'not-in-date',name:x.name,source:x.source,row:x.row,message:'This representative is in the source file but not in the selected weekly date. No new row was added because Add new is off.'});
    if(sourceMissing.length&&!options.addNew)warnings.push(countFmt(sourceMissing.length)+' source representative(s) are not in '+publication.us+'. Turn on Add new to insert them into that date block.');
    const insertAt=Math.max(...targetIndexes)+1,newRows=newRecords.map(r=>r.values),allRows=working.slice();if(newRows.length)allRows.splice(insertAt,0,...newRows);
    newRecords.forEach((r,j)=>r.rowNumber=insertAt+j+1);
    const impactRecords=[...modifiedRecords,...newRecords].sort((a,b)=>a.rowNumber-b.rowNumber);
    if(protectedText.count)warnings.push(countFmt(protectedText.count)+' imported text value(s) were prefixed with an apostrophe to prevent spreadsheet formula execution.');
    if(!impactRecords.length)warnings.push('No values would change for the selected date with the supplied source file(s).');
    const oldRecords=previousRows.slice(ta.headerRow+1).filter(r=>!blankRow(r)).length;
    const stats={mode:'modify',oldRecords,targetDateRows:targetIndexes.length,matchedRows,modifiedRows:modifiedRecords.length,modifiedCells,newRows:newRows.length,totalRecords:oldRecords+newRows.length,firstNewRow:newRows.length?insertAt+1:0,unchangedMatches,sourceMissing:sourceMissing.length,coaches:new Set(ap.records.map(a=>a.coach).filter(Boolean)).size,appointmentRows:ap.records.length,wiperRecords:wi.records.length,matched:matchedRows,wiperOnly:0,includedWiperOnly:0,appointmentOnly:0,ambiguous:ambiguousKeys.size,sharedNames:[...apByName.values()].filter(v=>v.length>1).length,conflicts:ap.conflicts.length+wi.conflicts.length,skipped:ap.skipped.length+wi.skipped.length,invalid:ap.invalid.length+wi.invalid.length,trailingBlanksRemoved:weeklyRows.length-last-1};
    return {mode:'modify',header,headerRow:ta.headerRow,previousRows,newRows,newRecords,impactRecords,allRows,mapping,stats,warnings,review,publication,analyses:{appointments:aa,wipers:wa,weekly:ta},appointmentRecords:ap.records};
  }
  function newWeeklyHeader(analyses) {
    const header=['Date','Sheet','Name','Manager'];
    for(const segment of ['Commercial','Consumer','Insurance','Total'])for(const metric of ['Opportunities','Appointments','Appointment Rate','Opportunity Rate'])header.push(segment+' '+metric);
    header.push('Wiper Count','Wiper Jobs','Wiper Rate','ACD Calls','Inbound Calls Per Hour','% Available');
    const seen=new Set(header.map(norm));
    for(const analysis of analyses.filter(Boolean))for(const column of analysis.columns){
      if(!column.raw||column.dim||column.key||Object.values(analysis.dims).includes(column.index)||seen.has(norm(column.raw)))continue;
      header.push(column.raw);seen.add(norm(column.raw));
    }
    return header;
  }
  function sortNewRecordsByCoach(records){
    const collator=new Intl.Collator('en',{sensitivity:'base',numeric:true});
    records.sort((a,b)=>{if(!a.coach&&b.coach)return 1;if(a.coach&&!b.coach)return -1;return collator.compare(a.coach,b.coach)||collator.compare(a.name,b.name);});
  }
  function assemble(input) {
    if((input.options||{}).mode==='modify')return assembleModify(input);
    const appointmentRows=input.appointmentRows||[],wiperRows=input.wiperRows||[],options=input.options||{},publication=dateInfo(input.date),warnings=[];
    if(!appointmentRows.length&&!wiperRows.length)throw new Error('Upload an appointment report, a wiper report, or both.');
    const aa=appointmentRows.length?analyze(appointmentRows,'appointments',options.appointmentColumns||{}):null,wa=wiperRows.length?analyze(wiperRows,'wipers',options.wiperColumns||{}):null;
    const empty=()=>({records:[],conflicts:[],invalid:[],skipped:[]});
    const ap=aa?sourceRecords(appointmentRows,aa,{period:options.appointmentPeriod,carryCoach:options.carryCoach,choices:options.sourceChoices}):empty(),wi=wa?sourceRecords(wiperRows,wa,{period:options.wiperPeriod,choices:options.sourceChoices}):empty();
    if(!ap.records.length&&!wi.records.length)throw new Error('No named records were found in the supplied reports for the selected source period.');
    if(aa&&!ap.records.length)warnings.push('No named appointment records were found. Wiper rows will use blank appointment fields.');
    if(wa&&!wi.records.length)warnings.push('No named wiper records were found. Appointment rows will use blank wiper fields.');
    const hasHistory=!!input.weeklyRows?.length,weeklyRows=hasHistory?input.weeklyRows:[newWeeklyHeader([aa,wa])],ta=analyze(weeklyRows,'weekly',hasHistory?(options.weeklyColumns||{}):{});
    const includeWiperOnly=!ap.records.length||options.includeWiperOnly!==false;
    const header=weeklyRows[ta.headerRow].map(text), width=header.length;
    const headerNames=header.filter(tidy).map(norm); if(new Set(headerNames).size<headerNames.length) throw new Error('The previous weekly file has duplicate column headers. Give each column a unique name before exporting.');
    let last=weeklyRows.length-1;while(last>ta.headerRow && blankRow(weeklyRows[last]))last--;
    const previousRows=weeklyRows.slice(0,last+1).map(r=>r.map(text));
    if(previousRows.slice(ta.headerRow+1).some(r=>r.slice(width).some(v=>tidy(v)))) throw new Error('Existing data extends beyond the weekly header. Add the missing column header before continuing.');
    const oldRecords=previousRows.slice(ta.headerRow+1).filter(r=>!blankRow(r)).length;
    const oldSameDate=previousRows.slice(ta.headerRow+1).filter(r=>comparableDate(r[ta.dims.date])===publication.iso).length;
    if(oldSameDate) warnings.push(countFmt(oldSameDate)+' existing rows already use '+publication.us+'. This tool appends another batch; it never replaces that date.');
    const apPeriods=aa?(options.appointmentPeriod?[options.appointmentPeriod]:aa.periods):[],wPeriods=wa?(options.wiperPeriod?[options.wiperPeriod]:wa.periods):[];
    if(apPeriods.length>1) warnings.push('The appointment report contains multiple periods. Use the source-period selector to limit the import; conflicting values will not be added together.');
    if(wPeriods.length>1) warnings.push('The wiper report contains multiple periods. Use the source-period selector to limit the import; conflicting values will not be added together.');
    if(apPeriods.length&&wPeriods.length&&JSON.stringify(apPeriods.map(comparableDate).sort())!==JSON.stringify(wPeriods.map(comparableDate).sort())) warnings.push('Source date labels differ. Appointments: '+apPeriods.join('; ')+'. Wipers: '+wPeriods.join('; ')+'. Every new Date will still be '+publication.us+'.');
    const protectedText={count:0};
    // Prefer explicit Accepted/Offered over Count/Jobs, independently on each side.
    const activeTargets=new Map();for(const c of ta.columns)if(c.key){const old=activeTargets.get(c.key);if(!old||c.rank>old.rank)activeTargets.set(c.key,c);}
    const mapping=header.map((h,i)=>{
      const col=ta.columns[i],dim=Object.entries(ta.dims).find(([,v])=>v===i)?.[0];
      if(dim)return {index:i,target:h,dimension:dim,status:'filled',description:dim==='date'?'Entered publication date':dim==='coach'?'Coach from appointment or wiper report':dim==='manager'?'Manager from the source or saved coach group':'Representative name'};
      if(col.key&&activeTargets.get(col.key)?.index!==i)return {index:i,target:h,key:col.key,status:'blank',description:'A more explicit destination column is used for this statistic.'};
      let src=null,source='';
      if(col.key){ if(col.key.startsWith('wiper.')) {src=wa?.keys.get(col.key);source='wipers';} else {src=aa?.keys.get(col.key);source='appointments';} }
      else if(tidy(h)) {
        src=aa?.columns.find(c=>!c.dim&&!Object.values(aa.dims).includes(c.index)&&c.raw&&norm(c.raw)===norm(h));source='appointments';
        if(!src){src=wa?.columns.find(c=>!c.dim&&!Object.values(wa.dims).includes(c.index)&&c.raw&&norm(c.raw)===norm(h));source='wipers';}
      }
      let percentOutput=false;
      if(col.key&&/rate$/.test(col.key)) {
        const vals=previousRows.slice(ta.headerRow+1).map(r=>tidy(r[i])).filter(Boolean).slice(-300);
        percentOutput=vals.length>0 && vals.filter(v=>v.endsWith('%')).length>vals.length/2;
      }
      return {index:i,target:h,key:col.key||'',source:src?source:'',sourceIndex:src?.index,sourceLabel:src?.label||'',status:src?'mapped':'blank',percentOutput,description:src?source+' · '+src.label:'No explicit source field. Left blank.'};
    });
    const apByName=new Map();for(const a of ap.records){if(!apByName.has(a.nameKey))apByName.set(a.nameKey,[]);apByName.get(a.nameKey).push(a);}
    const sharedNames=[...apByName].filter(([,rs])=>rs.length>1);
    const review=[...ap.conflicts,...wi.conflicts,...ap.invalid,...wi.invalid,...ap.skipped,...wi.skipped];
    sharedNames.forEach(([,rs])=>review.push({kind:'shared-name',name:rs[0].name,source:'appointments',row:rs.flatMap(r=>r.rows).join(', '),message:'This name appears under different coaches ('+rs.map(r=>r.coach||'no coach').join('; ')+'). Kept separate to avoid combining different people.'}));
    const assigned=new Map(),wiperOnly=[],ambiguous=[];let matched=0;
    for(const w of wi.records){
      let candidates=apByName.get(w.nameKey)||[];
      const manual=options.matches?.[w.id];let target=null;
      if(manual&&manual!=='__separate')target=ap.records.find(a=>a.id===manual)||null;
      else if(!manual){
        if(candidates.length===1)target=candidates[0];
        else if(candidates.length>1&&w.coach){const exact=candidates.filter(a=>a.coach===w.coach);if(exact.length===1)target=exact[0];}
      }
      if(target&&!assigned.has(target.id)){assigned.set(target.id,w);matched++;}
      else if((candidates.length>1&&!manual)||(target&&assigned.has(target.id))){
        const item={kind:'ambiguous',name:w.name,source:'wipers',row:w.rows.join(', '),wiperId:w.id,candidates:target?[target]:candidates,message:target?'More than one wiper record points to this representative. No second assignment was made.':'More than one appointment record has this name. Wipers are held for review, not assigned twice.'};ambiguous.push(item);review.push(item);
      } else {
        wiperOnly.push(w);review.push({kind:'wiper-only',name:w.name,source:'wipers',row:w.rows.join(', '),wiperId:w.id,message:!includeWiperOnly?'No appointment name match. Excluded by your option.':'Included with the wiper-source coach and blank appointment fields.'});
      }
    }
    const newRecords=[];
    function makeRow(a,w,kind){
      const name=a?.name||w?.name||'',coach=a?.displayCoach||a?.coach||w?.displayCoach||w?.coach||'';
      const values=mapping.map(m=>{
        if(m.dimension==='date')return publication.us;
        if(m.dimension==='coach')return safeNewText(coach,protectedText);
        if(m.dimension==='name')return safeNewText(name,protectedText);
        if(m.dimension==='manager')return safeNewText(a?.manager||w?.manager||'',protectedText);
        if(m.status!=='mapped')return '';
        const record=m.source==='appointments'?a:w;if(!record)return '';
        let v=record.cells[m.sourceIndex]??'';
        if(m.percentOutput&&v!=='')v=String(Number((Number(v)*100).toPrecision(14)))+'%';
        return m.key ? v : safeNewText(v,protectedText);
      });
      newRecords.push({values,name,coach,kind,appointmentId:a?.id||'',wiperId:w?.id||'',appointmentRows:a?.rows||[],wiperRows:w?.rows||[]});
    }
    for(const a of ap.records)makeRow(a,assigned.get(a.id),assigned.has(a.id)?'matched':'appointment-only');
    if(includeWiperOnly)for(const w of wiperOnly)makeRow(null,w,'wiper-only');
    sortNewRecordsByCoach(newRecords);
    for(const a of ap.records)if(!assigned.has(a.id))review.push({kind:'appointment-only',name:a.name,source:'appointments',row:a.rows.join(', '),message:'No wiper record was assigned. Wiper fields remain blank.'});
    if(ambiguous.length)warnings.push(countFmt(ambiguous.length)+' wiper name match(es) need review. Their values are not assigned or duplicated.');
    if(sharedNames.length)warnings.push(countFmt(sharedNames.length)+' representative name(s) occur under different coaches. These remain separate people unless the source is corrected.');
    if(ap.conflicts.length+wi.conflicts.length)warnings.push(countFmt(ap.conflicts.length+wi.conflicts.length)+' source record conflict(s). Conflicting cells are blank; use Review → Source conflicts to select a source row.');
    if(protectedText.count)warnings.push(countFmt(protectedText.count)+' new text values were prefixed with an apostrophe to prevent spreadsheet formula execution.');
    const newRows=newRecords.map(r=>r.values),allRows=previousRows.concat(newRows);
    const stats={oldRecords,newRows:newRows.length,totalRecords:oldRecords+newRows.length,firstNewRow:previousRows.length+1,coaches:new Set(newRecords.map(r=>coachKey(r.coach)).filter(Boolean)).size,appointmentRows:ap.records.length,wiperRecords:wi.records.length,matched,wiperOnly:wiperOnly.length,includedWiperOnly:includeWiperOnly?wiperOnly.length:0,appointmentOnly:ap.records.length-matched,ambiguous:ambiguous.length,sharedNames:sharedNames.length,conflicts:ap.conflicts.length+wi.conflicts.length,skipped:ap.skipped.length+wi.skipped.length,invalid:ap.invalid.length+wi.invalid.length,trailingBlanksRemoved:weeklyRows.length-last-1};
    return {header,headerRow:ta.headerRow,previousRows,newRows,newRecords,allRows,mapping,stats,warnings,review,publication,analyses:{appointments:aa,wipers:wa,weekly:ta},appointmentRecords:ap.records};
  }
  function csv(rows) { return '\uFEFF'+rows.map(r=>r.map(v=>{const s=text(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\r\n')+'\r\n'; }
  const API={workerSource:()=>' ('+weeklyFactory.toString()+')(globalThis);',text,tidy,norm,nameKey,blankRow,decodeText,delimiterOf,parseDelimited,dimKey,metricOf,describeColumns,detectHeader,analyze,sourceRecords,assemble,assembleModify,csv,dateInfo,dateMatches,colLabel,parseStat};
  if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.WeeklyCore=API;
})(typeof globalThis!=='undefined'?globalThis:this);
