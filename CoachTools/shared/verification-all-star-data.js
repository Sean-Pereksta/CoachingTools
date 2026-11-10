(function attachVerificationAllStarData(root) {
  'use strict';

  const tidy = value => String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
  const norm = value => tidy(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
  const isWeekly = type => /^weekly(?:Retail|Referral)$/.test(type);
  function nameKey(value) {
    if (root.VerificationAllStarCore?.nameKey) return root.VerificationAllStarCore.nameKey(value);
    if (root.WeeklyCore?.nameKey) return root.WeeklyCore.nameKey(value);
    let result = tidy(value).normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-');
    const comma = result.split(',');
    if (comma.length === 2 && comma.every(tidy)) result = tidy(comma[1]) + ' ' + tidy(comma[0]);
    return tidy(result);
  }
  function dayKey(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(tidy(value))) {
      const serial = Number(value);
      if (serial > 0 && serial < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
      return '';
    }
    const text = tidy(value);
    if (/\d\s*[-–—]\s*\d{1,2}\//.test(text)) return '';
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text);
    if (!match) {
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:$|[,\s])/.exec(text);
      if (us) match = ['', us[3].length === 2 ? String(+us[3] < 70 ? 2000 + +us[3] : 1900 + +us[3]) : us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')];
    }
    if (!match) return '';
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const date = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
  }
  function count(value) {
    if (!tidy(value)) return null;
    const number = Number(tidy(value).replace(/,/g, ''));
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }
  function score(value) {
    const text = tidy(value);
    if (!text) return null;
    let number = Number(text.replace(/,/g, '').replace(/%$/, ''));
    if (!Number.isFinite(number) || number < 0) return null;
    if (text.endsWith('%') || number > 1) number /= 100;
    return number <= 1 ? number : null;
  }
  const aliases = {
    name: ['name', 'agentname', 'agent', 'associate', 'associatename', 'representative', 'representativename', 'rep', 'repname', 'csr', 'csrname', 'ssrname', 'employee', 'employeename', 'employeefullname'],
    coach: ['sheet', 'coach', 'coachname', 'team', 'teamname', 'coachassigned', 'jobcoach', 'supervisor', 'supervisorname'],
    weeklyDate: ['date', 'week', 'weekending', 'reportdate', 'publicationdate', 'publishdate', 'statsdate', 'reportingperiod', 'period'],
    quality: ['score%', 'scorepct', 'score', 'qascore', 'qa%', 'evaluationscore', 'callquality'],
    qaDate: ['interactionstarttime', 'interactionstart', 'starttime', 'interactiontime', 'scoreddate', 'assigneddate', 'evaluationdate', 'date'],
    checklistDate: ['incidentdate', 'date', 'createdon', 'createddate', 'createddatetime', 'createdat', 'created'],
    incident: ['incident', 'incidenttype', 'incidentcategory', 'checklistitem', 'item', 'type'],
    description: ['description', 'details', 'notes', 'summary', 'desc', 'action'],
    corrective: ['corrective', 'correctives', 'correctiveaction', 'correctiveactions', 'correctivelevel', 'correctivetype', 'correctiveactionlevel', 'disciplinaryaction'],
    qaId: ['genesysevaluationid', 'evaluationid', 'evalid', 'evaluationidentifier', 'interactionid', 'conversationid', 'contactid', 'id'],
    itemId: ['itemid', 'checklistid', 'incidentid', 'recordid', 'id']
  };
  function field(header, names) {
    const normalized = header.map(norm);
    for (const name of names) {
      const index = normalized.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  }
  function layout(header, type) {
    const find = key => field(header, aliases[key]);
    const result = {name: find('name'), coach: find('coach')};
    if (isWeekly(type)) {
      result.date = find('weeklyDate');
      // Keep the same explicit Accepted/Offered preference as Weekly Data Builder.
      const columns = root.WeeklyCore?.describeColumns([header], 0);
      function metric(key, alternatives) {
        if (columns) return columns.filter(column => column.key === key).sort((a, b) => b.rank - a.rank)[0]?.index ?? -1;
        return field(header, alternatives);
      }
      result.accepted = metric('wiper.accepted', ['wipersaccepted','wiperaccepted','countwipersaccepted','wipersaccept','wipercount','wiperscount']);
      result.offered = metric('wiper.offered', ['wipersoffered','wiperoffered','countwipersoffered','wipersasked','wiperasked','wiperjobs']);
      result.valid = result.name >= 0 && result.date >= 0 && result.accepted >= 0 && result.offered >= 0;
    } else if (type === 'qa') {
      result.date = find('qaDate'); result.score = find('quality'); result.id = find('qaId');
      result.valid = result.name >= 0 && result.date >= 0 && result.score >= 0;
    } else {
      result.date = find('checklistDate'); result.incident = find('incident'); result.description = find('description'); result.corrective = find('corrective'); result.id = find('itemId');
      if (result.corrective < 0) result.corrective = header.findIndex(value => /^corrective(?:action)?/.test(norm(value)));
      result.valid = result.name >= 0 && result.date >= 0 && (result.incident >= 0 || result.description >= 0 || result.corrective >= 0);
    }
    return result;
  }
  function findHeader(rows, type) {
    let best = null;
    rows.slice(0, 60).forEach((header, index) => {
      if (!Array.isArray(header)) return;
      const map = layout(header, type);
      if (map.valid) {
        const strength = Object.values(map).filter(value => Number.isInteger(value) && value >= 0).length;
        if (!best || strength > best.strength) best = {header, index, map, strength};
      }
    });
    return best;
  }
  function canonicalRow(row, map, type, metadata) {
    const name = tidy(row[map.name]), key = nameKey(name), date = dayKey(row[map.date]);
    if (!name || /^(grand\s*)?(totals?|subtotals?|name|all reps)$/i.test(name)) return null;
    const base = {name, key, date, invalidDate: !date, coach: tidy(row[map.coach]), importedAt: metadata?.importedAt || '', datasetId: metadata?.id || metadata?.datasetId || ''};
    if (isWeekly(type)) {
      const accepted = count(row[map.accepted]), offered = count(row[map.offered]);
      return {...base, accepted, offered, invalid: accepted == null || offered == null || (offered === 0 && accepted > 0)};
    }
    if (type === 'qa') return {...base, quality: score(row[map.score]), id: tidy(row[map.id]), rawDate: tidy(row[map.date]), signature: JSON.stringify(row)};
    const incident = tidy(row[map.incident]), description = tidy(row[map.description]), corrective = tidy(row[map.corrective]);
    return {...base, incident, description, corrective, id: tidy(row[map.id]), signature: JSON.stringify(row), attendance: /absence|tardy/i.test(incident + ' ' + description), isCorrective: /final|written|verbal/i.test(corrective)};
  }
  function parseRows(type, rows, metadata) {
    const detected = findHeader(rows, type);
    if (!detected) return {rows: [], recognized: false, attendanceAvailable: false, correctivesAvailable: false};
    return {
      rows: rows.slice(detected.index + 1).map(row => canonicalRow(row, detected.map, type, metadata)).filter(Boolean),
      recognized: true,
      attendanceAvailable: detected.map.incident >= 0 || detected.map.description >= 0,
      correctivesAvailable: detected.map.corrective >= 0,
      header: detected.header
    };
  }
  function latestUnique(rows, type, diagnostics) {
    const selected = new Map();
    for (const row of rows.slice().sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')))) {
      const id = isWeekly(type) ? row.key + '\u001f' + row.date : row.id ? row.key + '\u001f' + row.id : row.key + '\u001f' + row.signature;
      const old = selected.get(id);
      if (!old) { selected.set(id, row); continue; }
      if (isWeekly(type) && old.datasetId === row.datasetId && (old.accepted !== row.accepted || old.offered !== row.offered)) {
        old.invalid = true;
        if (diagnostics) diagnostics.push(`Conflicting Wiper rows for ${row.name} on ${row.date}; those counts need review.`);
      }
    }
    return [...selected.values()];
  }
  function aggregate(input) {
    const month = input.month;
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a valid report month.');
    const diagnostics = [...(input.diagnostics || [])], sources = input.sources || {}, targetKeys = new Set((input.reps || []).map(rep => nameKey(rep.name)));
    // Referral wins when the same roster member/date is present in both stored categories.
    const referral = latestUnique(input.weekly || [], 'weeklyReferral', diagnostics), retail = latestUnique(input.retail || [], 'weeklyRetail', diagnostics);
    const stored = new Map(retail.map(row => [row.key + '\u001f' + row.date, row]));
    referral.forEach(row => stored.set(row.key + '\u001f' + row.date, row));
    let weekly = [...stored.values()];
    // An explicit upload replaces the same representative/publication date, rather than adding it twice.
    const merged = new Map(weekly.map(row => [row.key + '\u001f' + row.date, row]));
    for (const upload of input.uploads || []) {
      diagnostics.push(...(upload.diagnostics || []));
      let unmatched = 0, outside = 0;
      for (const row of upload.rows || []) {
        if (!targetKeys.has(row.key)) { unmatched++; continue; }
        if (!row.date.startsWith(month)) outside++;
        merged.set(row.key + '\u001f' + row.date, row);
      }
      if (unmatched) diagnostics.push(`${upload.fileName || 'Wiper upload'}: ${unmatched} name(s) are outside the monthly lane roster and were excluded.`);
      if (outside) diagnostics.push(`${upload.fileName || 'Wiper upload'}: ${outside} roster record(s) are outside ${month} and were excluded from this report.`);
    }
    const undatedWeekly = [...merged.values()].filter(row => row.invalidDate && targetKeys.has(row.key));
    weekly = [...merged.values()].filter(row => targetKeys.has(row.key) && row.date.startsWith(month));
    const uniqueQA = latestUnique(input.qa || [], 'qa'), uniqueChecklist = latestUnique(input.checklist || [], 'checklist');
    const qa = uniqueQA.filter(row => row.date.startsWith(month));
    const checklist = uniqueChecklist.filter(row => row.date.startsWith(month));
    const metrics = Object.create(null), weeks = [...new Set(weekly.map(row => row.date))].sort();
    for (const rep of input.reps || []) {
      const key = nameKey(rep.name), issues = [];
      const wipers = weekly.filter(row => row.key === key), allEvaluations = qa.filter(row => row.key === key), evaluations = allEvaluations.filter(row => row.quality != null), items = checklist.filter(row => row.key === key);
      const invalid = wipers.some(row => row.invalid) || undatedWeekly.some(row => row.key === key);
      const accepted = wipers.length && !invalid ? wipers.reduce((sum, row) => sum + row.accepted, 0) : null;
      const offered = wipers.length && !invalid ? wipers.reduce((sum, row) => sum + row.offered, 0) : null;
      const undatedQA = uniqueQA.some(row => row.key === key && row.invalidDate);
      const undatedItems = uniqueChecklist.filter(row => row.key === key && row.invalidDate);
      const quality = !undatedQA && evaluations.length && evaluations.length === allEvaluations.length ? evaluations.reduce((sum, row) => sum + row.quality, 0) / evaluations.length : null;
      const attendance = sources.checklist?.attendanceAvailable && !undatedItems.some(row => row.attendance) ? items.filter(row => row.attendance).length : null;
      const correctives = sources.checklist?.correctivesAvailable && !undatedItems.some(row => row.isCorrective) ? items.filter(row => row.isCorrective).length : null;
      if (accepted == null) issues.push(invalid ? 'Wiper counts need review' : 'No Wiper data for this month');
      else if (!offered) issues.push('No Wipers offered; rate is unavailable');
      if (wipers.length && weeks.some(week => !wipers.some(row => row.date === week))) issues.push(`Missing Wiper data for ${weeks.filter(week => !wipers.some(row => row.date === week)).length} available week(s)`);
      if (quality == null) issues.push(undatedQA ? 'Evaluation dates need review' : allEvaluations.length ? 'Evaluation scores need review' : 'No scored evaluations for this month');
      if (attendance == null && !undatedItems.some(row => row.attendance)) issues.push('Attendance source columns unavailable');
      if (correctives == null && !undatedItems.some(row => row.isCorrective)) issues.push('Corrective source column unavailable');
      if (undatedItems.some(row => row.attendance || row.isCorrective)) issues.push('Checklist item dates need review');
      metrics[key] = {accepted, offered, wiperRate: offered > 0 ? accepted / offered : null, quality, qaCount: evaluations.length, attendance, correctives, issues,
        weeklyWipers: wipers.map(row => ({week: row.date, accepted: row.accepted, offered: row.offered, rate: !row.invalid && row.offered > 0 ? row.accepted / row.offered : null})).sort((a, b) => a.week.localeCompare(b.week))};
    }
    return {metrics, diagnostics: [...new Set(diagnostics)], sources, weeks};
  }
  async function readType(type, api, data, targetKeys, month) {
    const result = {rows: [], available: false, attendanceAvailable: false, correctivesAvailable: false, records: 0, diagnostics: []};
    // History metadata is lightweight; stream each retained dataset and discard unrelated people/months.
    let history = data?.getHistory ? await data.getHistory(type, {metadataOnly: true, activeOnly: true}) : [];
    let current;
    if (!history.length) {
      current = await api.get(type, {includeRecord: true});
      if (current) history = [current];
    }
    for (const metadata of history.filter(record => !record.supersededBy).sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')))) {
      let chunks;
      if (current?.data && current === metadata) {
        const packs = current.data.workbook?.data || {};
        chunks = (async function* () { for (const [sheetName, sheet] of Object.entries(packs)) yield {sheetName, rowStart: 0, rows: sheet.aoa || [], metadata}; })();
      } else chunks = api.streamRows(type, {datasetId: metadata.id || metadata.datasetId});
      const layouts = new Map();
      for await (const chunk of chunks) {
        if (!layouts.has(chunk.sheetName) || chunk.rowStart === 0) {
          const detected = findHeader(chunk.rows, type);
          layouts.set(chunk.sheetName, detected ? {...detected, absoluteHeader: (chunk.rowStart || 0) + detected.index} : null);
          if (detected) {
            result.available = true;
            result.attendanceAvailable ||= detected.map.incident >= 0 || detected.map.description >= 0;
            result.correctivesAvailable ||= detected.map.corrective >= 0;
          }
        }
        const detected = layouts.get(chunk.sheetName);
        if (!detected) continue;
        chunk.rows.forEach((row, index) => {
          if ((chunk.rowStart || 0) + index <= detected.absoluteHeader) return;
          const parsed = canonicalRow(row, detected.map, type, metadata);
          if (parsed && targetKeys.has(parsed.key) && (parsed.invalidDate || parsed.date.startsWith(month))) result.rows.push(parsed);
        });
      }
      result.records++;
    }
    return result;
  }
  async function scopeRoster(reps, options) {
    const api = options?.appData || root.CoachToolsAppData, data = options?.data || root.CoachToolsData;
    const scope = api?.getScope?.() || root.CoachToolsStorage?.getScope?.() || {mode:'all'};
    const scopeLabel = scope.label || (scope.mode && scope.mode !== 'all' ? (scope.coaches || scope.representatives || []).join(', ') || scope.mode : 'All people');
    if (!scope.mode || scope.mode === 'all') return {reps,scopeApplied:false,scopeLabel};
    if (!data?.filterDataset) return {reps:[],scopeApplied:true,scopeLabel};
    const dataset = {workbook:{sheets:['Roster'],data:{Roster:{aoa:[['Representative','Coach','RosterIndex'],...reps.map((rep,index)=>[rep.name,rep.coach,index])]}}}};
    const filtered = await data.filterDataset(dataset,'weeklyReferral',scope);
    const indexes = new Set((filtered?.workbook?.data?.Roster?.aoa || []).slice(1).map(row=>Number(row[2])));
    return {reps:reps.filter((_,index)=>indexes.has(index)),scopeApplied:true,scopeLabel};
  }
  function filterWarningsForRoster(warnings, reps, scopeApplied) {
    if (!scopeApplied) return warnings || [];
    const allowed = new Set((reps || []).map(rep=>nameKey(rep.name)));
    return (warnings || []).filter(warning=>{
      const text = String(warning), named = /(?:conflicting coaches in phone data|conflicting activity values) for (.+)\.$/i.exec(text) || /^(.+) appears in more than one lane;/i.exec(text);
      return !named || allowed.has(nameKey(named[1]));
    });
  }
  async function loadMonth(month, reps, options) {
    const api = options?.appData || root.CoachToolsAppData, data = options?.data || root.CoachToolsData;
    if (!api) throw new Error('Shared CoachTools data is unavailable. Open this app from CoachTools.');
    await api.ready();
    const roster = await scopeRoster(reps, options);
    reps = roster.reps;
    const keys = new Set(reps.map(rep => nameKey(rep.name))), types = ['weeklyReferral', 'weeklyRetail', 'qa', 'checklist'];
    const results = await Promise.allSettled(types.map(type => readType(type, api, data, keys, month)));
    const sources = {}, diagnostics = [], rows = {};
    results.forEach((result, index) => {
      const type = types[index];
      if (result.status === 'fulfilled') {
        sources[type] = {...result.value, rows: undefined}; rows[type] = result.value.rows;
        if (!result.value.available && type !== 'weeklyRetail') diagnostics.push(`No readable ${type === 'qa' ? '90-day evaluation' : type === 'checklist' ? 'checklist' : 'Referral Wiper'} data found in shared storage.`);
      } else {
        sources[type] = {available: false, error: result.reason?.message || String(result.reason)}; rows[type] = [];
        diagnostics.push(`Could not read ${type}: ${sources[type].error}`);
      }
    });
    if (sources.checklist.available && !sources.checklist.correctivesAvailable) diagnostics.push('The checklist source has no Corrective column; corrective counts remain unavailable.');
    const result = aggregate({month, reps, weekly: rows.weeklyReferral, retail: rows.weeklyRetail, qa: rows.qa, checklist: rows.checklist, sources, diagnostics, uploads: options?.uploads || []});
    result.diagnostics.push(`Wiper coverage: ${result.weeks.length} publication date(s) available for the monthly roster in ${month}. Weeks are included by their publication date.`);
    if (roster.scopeApplied) result.diagnostics.push('The monthly roster and report are limited to the selected CoachTools scope.');
    result.reps = reps;
    result.scopeApplied = roster.scopeApplied;
    result.scopeLabel = roster.scopeLabel;
    return result;
  }
  function parseWiperRows(rows, options) {
    const core = options?.core || root.WeeklyCore;
    if (!core) throw new Error('The Weekly Data Builder parser is unavailable.');
    const analysis = core.analyze(rows, 'wipers', options?.columns || {}), periods = analysis.periods;
    const selectedPeriod = options?.period || (periods.length === 1 ? periods[0] : '');
    if (periods.length > 1 && !selectedPeriod) return {rows: [], periods, selectedPeriod, requiresSelection: true, diagnostics: []};
    if (selectedPeriod && periods.length && !periods.includes(selectedPeriod)) throw new Error('Select a source period from this Wiper file.');
    const publicationDate = dayKey(options?.publicationDate) || dayKey(selectedPeriod);
    if (!publicationDate) throw new Error('Enter the Wiper publication date for this upload.');
    const acceptedColumn = analysis.keys.get('wiper.accepted'), offeredColumn = analysis.keys.get('wiper.offered');
    if (!acceptedColumn || !offeredColumn) throw new Error('Wiper data needs Accepted and Offered (or Asked / Jobs) count columns.');
    const parsed = core.sourceRecords(rows, analysis, {period: selectedPeriod || undefined});
    if (!parsed.records.length) throw new Error('No named Wiper records were found in the selected worksheet and period.');
    const normalized = parsed.records.map(record => {
      const accepted = count(record.cells[acceptedColumn.index]), offered = count(record.cells[offeredColumn.index]);
      return {name: record.name, key: nameKey(record.name), date: publicationDate, coach: record.displayCoach, accepted, offered, invalid: accepted == null || offered == null || (offered === 0 && accepted > 0), datasetId: 'upload:' + (options?.fileName || 'wipers'), importedAt: new Date().toISOString()};
    });
    const diagnostics = [...analysis.notices, ...parsed.conflicts.map(item => item.message), ...parsed.invalid.map(item => item.message)];
    // Duplicate names under different coaches cannot be assigned safely to a single roster entry.
    const duplicates = new Map();
    normalized.forEach(row => { if (duplicates.has(row.key)) { row.invalid = true; duplicates.get(row.key).invalid = true; } else duplicates.set(row.key, row); });
    if ([...duplicates.values()].some(row => row.invalid)) diagnostics.push('Representatives with Wiper count or name conflicts are excluded from rankings; other eligible representatives can still win.');
    return {rows: [...duplicates.values()], periods, selectedPeriod, requiresSelection: false, diagnostics};
  }
  async function parseWiperUpload(file, options) {
    options = options || {};
    if (!file || file.size > 50 * 1024 * 1024) throw new Error('Choose a Wiper file under 50 MB.');
    const core = options.core || root.WeeklyCore;
    if (!core) throw new Error('The Weekly Data Builder parser is unavailable.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['csv','tsv','txt','xlsx','xls'].includes(extension)) throw new Error('Choose an Excel, CSV, TSV, or TXT Wiper file.');
    const buffer = await file.arrayBuffer(); let rows, sheets = [], selectedSheet = '';
    if (extension === 'xlsx' || extension === 'xls') {
      const xlsx = options.XLSX || root.XLSX;
      if (!xlsx) throw new Error('The Excel reader is unavailable.');
      const workbook = xlsx.read(buffer, {type: 'array', cellDates: false});
      sheets = workbook.SheetNames;
      const readSheet = name => xlsx.utils.sheet_to_json(workbook.Sheets[name], {header: 1, raw: false, defval: '', blankrows: true});
      const unreadable = message => ({fileName:file.name,sheets,selectedSheet,rows:[],periods:[],selectedPeriod:'',requiresSelection:true,diagnostics:[message]});
      if (options.sheet) {
        selectedSheet = options.sheet;
        if (!workbook.Sheets[selectedSheet]) return unreadable('Select a worksheet from this Wiper file.');
        rows = readSheet(selectedSheet);
        try {
          const analysis = core.analyze(rows, 'wipers', options.columns || {});
          if (!analysis.keys.has('wiper.accepted') || !analysis.keys.has('wiper.offered')) return unreadable('The selected worksheet needs Accepted and Offered count columns. Choose another worksheet.');
        } catch (_) { return unreadable('The selected worksheet has no readable Wiper table. Choose another worksheet.'); }
      } else {
        // A workbook may start with instructions. Find a readable count table before
        // selecting a sheet, keeping all sheet choices available in the interface.
        const candidates = [...sheets.filter(name => /wiper/i.test(name)), ...sheets.filter(name => !/wiper/i.test(name))];
        for (const name of candidates) {
          const candidateRows = readSheet(name);
          try {
            const analysis = core.analyze(candidateRows, 'wipers', options.columns || {});
            if (analysis.keys.has('wiper.accepted') && analysis.keys.has('wiper.offered')) { selectedSheet = name; rows = candidateRows; break; }
          } catch (_) { /* Continue past instructions and unrelated tables. */ }
        }
        if (!rows) return unreadable('Choose a worksheet containing representative names and Wipers Accepted / Offered counts.');
      }
    } else {
      rows = core.parseDelimited(core.decodeText(buffer).text).rows;
    }
    return {...parseWiperRows(rows, {...options, fileName: file.name}), fileName: file.name, sheets, selectedSheet};
  }

  const api = {VERSION: '1.0.0', nameKey, dayKey, parseRows, aggregate, scopeRoster, filterWarningsForRoster, loadMonth, parseWiperRows, parseWiperUpload};
  root.VerificationAllStarData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
