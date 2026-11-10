(function (root) {
  'use strict';
  const clean = value => String(value == null ? '' : value).normalize('NFKC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const headerKey = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  function normalizeName(value) {
    let name = clean(value).toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-');
    if ((name.match(/,/g) || []).length === 1) {
      const parts = name.split(',').map(clean);
      if (parts[0] && parts[1]) name = parts[1] + ' ' + parts[0];
    }
    return name;
  }
  function number(value) {
    if (value == null || clean(value) === '' || typeof value === 'boolean') return null;
    const result = Number(typeof value === 'string' ? value.replace(/,/g, '').trim() : value);
    return Number.isFinite(result) ? result : null;
  }
  function previousMonth(date) {
    const current = date instanceof Date ? date : new Date(date || Date.now());
    const year = current.getFullYear(), month = current.getMonth();
    return month ? year + '-' + String(month).padStart(2, '0') : (year - 1) + '-12';
  }
  function selectMonthSheet(sheetNames, month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month || previousMonth());
    if (!match || +match[2] < 1 || +match[2] > 12) return null;
    const year = match[1], index = +match[2] - 1, full = MONTHS[index], short = full.slice(0, 3);
    const candidates = [];
    for (const name of sheetNames || []) {
      const normalized = clean(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const tokens = normalized.split(' '), numeric = normalized.match(/^(\d{4}) (\d{1,2})$|^(\d{1,2}) (\d{4})$/);
      const textual = tokens.includes(full) || tokens.includes(short) || (index === 8 && tokens.includes('sept'));
      const dateMatch = numeric && ((numeric[1] === year && +numeric[2] === index + 1) || (numeric[4] === year && +numeric[3] === index + 1));
      if (!textual && !dateMatch) continue;
      const years = tokens.filter(t => /^\d{4}$/.test(t));
      const shortYears = tokens.filter(t => /^\d{2}$/.test(t));
      if (years.length && !years.includes(year)) continue;
      if (!years.length && textual && shortYears.length && !shortYears.includes(year.slice(2))) continue;
      candidates.push({name, score: years.includes(year) || dateMatch ? 3 : shortYears.includes(year.slice(2)) ? 2 : 1});
    }
    candidates.sort((a,b) => b.score - a.score);
    return candidates.length ? candidates[0].name : null;
  }
  function workbookSheets(workbook, XLSX) {
    if (!workbook || typeof workbook !== 'object') return {};
    if (!workbook.Sheets) return workbook;
    const sheets = {};
    for (const name of workbook.SheetNames || Object.keys(workbook.Sheets)) {
      const sheet = workbook.Sheets[name];
      if (Array.isArray(sheet)) sheets[name] = sheet;
      else if (XLSX && XLSX.utils) {
        const end = sheet && sheet['!ref'] ? sheet['!ref'].split(':').pop() : 'A1';
        sheets[name] = XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', raw:true, blankrows:true, range:'A1:' + end});
      }
      else throw new Error('A workbook reader is required for spreadsheet worksheets.');
    }
    return sheets;
  }
  const isNameLabel = value => /^(name|names|fullname|staff|staffname|employee|employeename|employeefullname|representative|representativename|rep|repname|agent|agentname)$/.test(headerKey(value));
  const isTotal = value => /^(totals?|grandtotals?)$/.test(headerKey(value));
  const isMetricLabel = value => /%/.test(clean(value)) || /^(acw|acwtime|acwtimepercall|aftercallwork|aftercallworktime|aht|averagehandletime|avghandletime|handletime|talktime|averagetalktime|holdtime|averageholdtime|staffedtime|totalstaffedtime|staffedhours|totalstaffedhours|loggedintime|occupancy|utilization|servicelevel|answer(ed)?calls|callsanswered|callshandled|totalcalls|abandonedcalls|totalverifications|verificationactivity|verificationactivityperstaffedtime|avgcasesperhrsalesforce|vaph|wipers|callquality|attendances?|correctives)$/.test(headerKey(value));
  const isPerson = value => clean(value) && /[a-z\u00c0-\uffff]/i.test(clean(value)) && !isNameLabel(value) && !isTotal(value) && !isMetricLabel(value);
  function parseMonthly(workbook, XLSX) {
    const sheets = workbookSheets(workbook, XLSX), reps = [], warnings = [];
    const laneNames = Object.keys(sheets);
    const coachSheetName = laneNames.find(name => headerKey(name) === 'phonedata');
    const coaches = new Map();
    if (coachSheetName) {
      const rows = sheets[coachSheetName] || [];
      let header = rows.findIndex(row => row.some(v => headerKey(v) === 'teamname'));
      let coachColumn = 2, nameColumn = 0;
      if (header >= 0) {
        coachColumn = rows[header].findIndex(v => headerKey(v) === 'teamname');
        const named = rows[header].findIndex(isNameLabel);
        if (named >= 0) nameColumn = named;
      } else header = -1;
      for (const row of rows.slice(header + 1)) {
        if (isPerson(row[nameColumn]) && clean(row[coachColumn])) {
          const key = normalizeName(row[nameColumn]), coach = clean(row[coachColumn]);
          if (coaches.has(key) && coaches.get(key) !== coach) warnings.push('Conflicting coaches in Phone Data for ' + clean(row[nameColumn]) + '.');
          else coaches.set(key, coach);
        }
      }
    } else warnings.push('Phone Data tab was not found. Coaches need review.');
    const globalNames = new Map();
    for (let lane = 1; lane <= 5; lane++) {
      const sheetName = laneNames.find(name => headerKey(name) === 'lane' + lane);
      if (!sheetName) { warnings.push('Lane ' + lane + ' tab was not found.'); continue; }
      const rows = sheets[sheetName] || [], namesColumn = 26;
      const nameHeaders = [];
      rows.forEach((row, index) => { if (isNameLabel(row[namesColumn])) nameHeaders.push(index); });
      // The first roster is authoritative; the repeated roster below it supplies activity.
      const secondHeader = nameHeaders.find(index => index > Math.max(4, nameHeaders[0] == null ? 2 : nameHeaders[0]));
      const metricHeader = rows.findIndex((row,index) => index > 4 && row.some(value => headerKey(value) === 'verificationactivityperstaffedtime'));
      const sectionStart = secondHeader == null ? metricHeader : secondHeader;
      const rosterEnd = sectionStart >= 0 ? sectionStart : rows.length;
      const activityHeader = metricHeader >= 0 && metricHeader >= rosterEnd ? metricHeader : sectionStart;
      let valueColumn = 37;
      if (activityHeader >= 0) {
        const found = rows[activityHeader].findIndex(value => headerKey(value) === 'verificationactivityperstaffedtime');
        if (found >= 0) valueColumn = found;
        else warnings.push('Lane ' + lane + ': activity header not found; using column AL in the second section.');
      } else warnings.push('Lane ' + lane + ': second activity section was not found.');
      const values = new Map();
      if (sectionStart >= 0) {
        for (let rowIndex = Math.max(sectionStart, activityHeader) + 1; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex], label = row[namesColumn];
          if (isNameLabel(label)) break;
          if (!isPerson(label)) continue;
          const key = normalizeName(label), value = number(row[valueColumn]);
          if (values.has(key) && values.get(key) !== value) {
            values.set(key, null);
            warnings.push('Lane ' + lane + ': conflicting activity values for ' + clean(label) + '.');
          } else if (!values.has(key)) values.set(key, value);
        }
      }
      const seen = new Set();
      for (let rowIndex = 5; rowIndex < rosterEnd; rowIndex++) {
        const name = clean((rows[rowIndex] || [])[namesColumn]);
        // The authoritative roster ends at its own section boundary. Summary
        // labels between that roster and the activity table are not people.
        if ((seen.size && (isTotal(name) || isNameLabel(name))) || isMetricLabel(name)) break;
        if (!isPerson(name)) continue;
        const key = normalizeName(name);
        if (seen.has(key)) continue;
        seen.add(key);
        if (globalNames.has(key) && globalNames.get(key) !== lane) warnings.push(name + ' appears in more than one lane; review the monthly roster.');
        globalNames.set(key, lane);
        reps.push({name, key, lane, coach:coaches.get(key) || '', vaph:values.has(key) ? values.get(key) : null});
      }
      if (!seen.size) warnings.push('Lane ' + lane + ': no representative names found in AA6 onward.');
    }
    return {reps, warnings};
  }
  function parseLane3(workbook, sheetName, XLSX) {
    const sheets = workbookSheets(workbook, XLSX), values = {}, warnings = [];
    if (!Object.prototype.hasOwnProperty.call(sheets, sheetName)) return {values, warnings:['Select a Lane 3 month tab.']};
    const rows = sheets[sheetName] || [];
    let metricRow = rows.findIndex(row => row.some(value => headerKey(value) === 'avgcasesperhrsalesforce'));
    let metricColumn = 3, nameColumn = 0;
    if (metricRow >= 0) {
      metricColumn = rows[metricRow].findIndex(value => headerKey(value) === 'avgcasesperhrsalesforce');
      const foundName = rows[metricRow].findIndex(isNameLabel);
      if (foundName >= 0) nameColumn = foundName;
    } else {
      metricRow = rows.findIndex(row => row.some(isNameLabel));
      if (metricRow >= 0) nameColumn = rows[metricRow].findIndex(isNameLabel);
      warnings.push('Lane 3: Avg Cases per hr Salesforce header not found; using column D.');
    }
    for (const row of rows.slice(metricRow + 1)) {
      const label = row[nameColumn];
      if (!isPerson(label)) continue;
      const key = normalizeName(label), value = number(row[metricColumn]);
      if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== value) {
        values[key] = null;
        warnings.push('Lane 3: conflicting activity values for ' + clean(label) + '.');
      } else if (!Object.prototype.hasOwnProperty.call(values, key)) values[key] = value;
    }
    return {values, warnings};
  }
  const MEASURES = Object.freeze([
    {id:'wipers',label:'Wipers',descending:true}, {id:'vaph',label:'VAPH',descending:true},
    {id:'quality',label:'Call Quality',descending:true}, {id:'attendance',label:'Attendance',descending:false},
    {id:'correctives',label:'Correctives',descending:false}
  ].map(Object.freeze));
  const DEFAULT_MEASURES = ['wipers','vaph','quality'];
  const fieldLabels = Object.fromEntries(MEASURES.map(measure => [measure.id,measure.label]));
  function measureList(requested, allowEmpty) {
    if (!Array.isArray(requested) || (!allowEmpty && !requested.length)) throw new Error('Select at least one ranking measure.');
    const ids = requested.map(value => clean(value).toLowerCase());
    if (ids.some(id => !MEASURES.some(measure => measure.id === id))) throw new Error('Choose ranking measures from Wipers, VAPH, Call Quality, Attendance, and Correctives.');
    return MEASURES.filter(measure => ids.includes(measure.id)).map(measure => measure.id);
  }
  function normalizeLaneSettings(settings) {
    settings = settings == null ? {} : settings;
    if (typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Choose valid lane ranking settings.');
    const legacy = Object.prototype.hasOwnProperty.call(settings,'measures') ? measureList(settings.measures,false) : DEFAULT_MEASURES;
    const requiredMeasures = measureList(Object.prototype.hasOwnProperty.call(settings,'requiredMeasures') ? settings.requiredMeasures : legacy,true);
    const rankedMeasures = measureList(Object.prototype.hasOwnProperty.call(settings,'rankedMeasures') ? settings.rankedMeasures : legacy,false);
    const penalty = settings.correctivePenalty === undefined ? 500 : number(settings.correctivePenalty);
    if (penalty == null || penalty < 0) throw new Error('Corrective penalty must be a nonnegative number.');
    if (settings.requireAllWiperWeeks !== undefined && typeof settings.requireAllWiperWeeks !== 'boolean') throw new Error('The Wiper week requirement must be on or off.');
    if (settings.missingRankedPolicy !== undefined && settings.missingRankedPolicy !== 'last') throw new Error('Unavailable ranked measures must receive last-place points.');
    return {requiredMeasures,rankedMeasures,requireAllWiperWeeks:settings.requireAllWiperWeeks === true,correctivePenalty:penalty,missingRankedPolicy:'last'};
  }
  function normalizeSettings(settings) {
    settings = settings == null ? {} : settings;
    if (typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Choose valid ranking settings.');
    const hasLanes = Object.prototype.hasOwnProperty.call(settings,'lanes');
    if (hasLanes && (!settings.lanes || typeof settings.lanes !== 'object' || Array.isArray(settings.lanes))) throw new Error('Choose valid settings for lanes 1 through 5.');
    if (hasLanes && Object.keys(settings.lanes).some(lane => !/^[1-5]$/.test(lane))) throw new Error('Choose a lane from 1 through 5.');
    return {lanes:Object.fromEntries([1,2,3,4,5].map(lane => {
      try { return [String(lane),normalizeLaneSettings(hasLanes ? settings.lanes[lane] : settings)]; }
      catch (error) { throw new Error('Lane ' + lane + ': ' + error.message); }
    }))};
  }
  function getLaneSettings(settings, lane) {
    if (!/^[1-5]$/.test(String(lane))) throw new Error('Choose a lane from 1 through 5.');
    if (settings && Object.prototype.hasOwnProperty.call(settings,'lanes') && (!settings.lanes || typeof settings.lanes !== 'object' || Array.isArray(settings.lanes))) throw new Error('Choose valid settings for lanes 1 through 5.');
    return normalizeLaneSettings(settings && Object.prototype.hasOwnProperty.call(settings,'lanes') ? settings.lanes[lane] : settings);
  }
  function issueMetric(value, message) {
    const aliases = {wiper:'wipers',wipers:'wipers',vaph:'vaph',activity:'vaph',quality:'quality',qa:'quality',evaluation:'quality',evaluations:'quality',callquality:'quality',attendance:'attendance',corrective:'correctives',correctives:'correctives',checklist:'checklist',identity:'identity',source:'source'};
    if (/identity|duplicate (?:representative|person|name)|ambiguous (?:representative|name)/i.test(message)) return 'identity';
    if (aliases[headerKey(value)]) return aliases[headerKey(value)];
    if (/\bwiper|\baccepted\b|\boffered\b/i.test(message)) return 'wipers';
    if (/\bvaph\b|activity per|cases per hr/i.test(message)) return 'vaph';
    if (/\bqa\b|evaluat|call quality|quality score/i.test(message)) return 'quality';
    if (/checklist/i.test(message)) return 'checklist';
    if (/attendance/i.test(message) && /corrective/i.test(message)) return 'checklist';
    if (/attendance/i.test(message)) return 'attendance';
    if (/corrective/i.test(message)) return 'correctives';
    return 'source';
  }
  function normalizeIssue(issue) {
    if (!issue) return null;
    const value = typeof issue === 'string' ? {message:issue,blocking:true} : issue;
    if (typeof value !== 'object') return null;
    const message = clean(value.message) || 'Missing or conflicting source data.';
    const metric = /identity/.test(clean(value.code)) ? 'identity' : issueMetric(value.metric,message);
    const missingWeeks = value.code === 'missing-wiper-weeks' || (/missing.*wiper.*week|wiper.*missing.*week/i.test(message));
    const code = missingWeeks ? 'missing-wiper-weeks' : clean(value.code) || 'source-issue';
    return {code,metric:missingWeeks ? 'wipers' : metric,message,
      blocking:value.blocking !== false && value.severity !== 'warning' && value.severity !== 'info'};
  }
  function evaluateEligibility(row, settings, duplicate) {
    const required = new Set(settings.requiredMeasures), ranked = new Set(settings.rankedMeasures), details = [], dataWarnings = [];
    const missing = settings.requiredMeasures.filter(field => row[field] == null);
    const missingRanked = new Set(settings.rankedMeasures.filter(field => row[field] == null));
    missing.forEach(field => details.push({code:'missing-' + field,metric:field,message:'Missing or invalid ' + fieldLabels[field] + '.'}));
    for (const issue of row.issueDetails) {
      const affected = issue.metric === 'checklist' ? ['attendance','correctives'] : [issue.metric];
      const requiredSource = affected.some(field => required.has(field));
      const rankedFields = affected.filter(field => ranked.has(field));
      const identitySource = issue.metric === 'source' || issue.metric === 'identity';
      if (!identitySource && !requiredSource && !rankedFields.length) continue;
      const detail = {code:issue.code,metric:issue.metric,message:issue.message};
      if (issue.code === 'missing-wiper-weeks') {
        (required.has('wipers') && settings.requireAllWiperWeeks ? details : dataWarnings).push(detail);
      } else if (issue.blocking && (identitySource || requiredSource)) details.push(detail);
      else {
        dataWarnings.push(detail);
        if (issue.blocking) rankedFields.forEach(field => missingRanked.add(field));
      }
    }
    settings.rankedMeasures.filter(field => row[field] == null && !required.has(field)).forEach(field => dataWarnings.push({
      code:'missing-ranked-' + field,metric:field,message:'Missing or invalid ' + fieldLabels[field] + '; assigned joint last-place points.'
    }));
    const provisional = details.length > 0;
    if (duplicate) details.push({code:'duplicate-identity',metric:'identity',message:'Duplicate representative in the monthly roster; resolve the duplicate before ranking.'});
    const unique = values => [...new Map(values.map(value => [value.code + '|' + value.metric + '|' + value.message,value])).values()];
    const exclusionDetails = unique(details);
    return {missing,missingRankedMeasures:settings.rankedMeasures.filter(field => missingRanked.has(field)),provisional,eligible:!exclusionDetails.length,
      exclusionDetails,exclusionReasons:exclusionDetails.map(detail => detail.message),dataWarnings:unique(dataWarnings)};
  }
  function summarizeExclusions(rows) {
    const reasons = new Map();
    for (const row of rows) for (const detail of row.exclusionDetails) {
      const key = detail.code + '|' + detail.metric;
      if (!reasons.has(key)) {
        const label = detail.code === 'missing-wiper-weeks' ? 'Missing Wiper weeks' : detail.code === 'duplicate-identity' ? 'Duplicate representative identity' : detail.message;
        reasons.set(key,{code:detail.code,metric:detail.metric,label,people:new Set()});
      }
      reasons.get(key).people.add(row.key);
    }
    return [...reasons.values()].map(({people,...reason}) => ({...reason,count:people.size})).sort((a,b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  function buildReport(options) {
    const {reps = [], lane3Values = {}, metrics = {}, month = ''} = options || {};
    const settings = normalizeSettings(options && options.settings);
    const normalizedMetrics = new Map(Object.entries(metrics instanceof Map ? Object.fromEntries(metrics) : metrics).map(([key,value]) => [normalizeName(key), value]));
    const lane3 = new Map(Object.entries(lane3Values instanceof Map ? Object.fromEntries(lane3Values) : lane3Values).map(([key,value]) => [normalizeName(key), value]));
    const warnings = [], rows = reps.map(rep => {
      const key = normalizeName(rep.key || rep.name), metric = normalizedMetrics.get(key) || {};
      const accepted = number(metric.accepted), offered = number(metric.offered);
      const wipers = accepted != null && accepted >= 0 && offered != null && offered > 0 && accepted <= offered ? accepted / offered : null;
      const rawVaph = Number(rep.lane) === 3 ? lane3.get(key) : rep.vaph;
      const vaph = number(rawVaph), quality = number(metric.quality), attendance = number(metric.attendance), correctives = number(metric.correctives);
      const rawIssues = Array.isArray(metric.issueDetails) ? metric.issueDetails : Array.isArray(metric.issues) ? metric.issues : metric.issues ? [metric.issues] : [];
      const issues = rawIssues.map(normalizeIssue).filter(Boolean);
      const result = {...rep, key, lane:Number(rep.lane), accepted, offered, wipers, wiperRate:wipers, vaph:vaph != null && vaph >= 0 ? vaph : null,
        quality:quality != null && quality >= 0 && quality <= 1 ? quality : null, qaCount:number(metric.qaCount),
        attendance:attendance != null && attendance >= 0 && Number.isInteger(attendance) ? attendance : null,
        correctives:correctives != null && correctives >= 0 && Number.isInteger(correctives) ? correctives : null,
        weeklyWipers:metric.weeklyWipers || [], issues, issueDetails:issues, laneSettings:getLaneSettings(settings,Number(rep.lane)),
        ranks:Object.fromEntries(MEASURES.map(measure => [measure.id,null])), total:null, penalty:null, missingPenaltyAdjustment:0,laneRank:null, winner:false};
      if (!result.coach) warnings.push(result.name + ': coach was not found in Phone Data.');
      return result;
    });
    const keyCounts = new Map();
    rows.forEach(row => keyCounts.set(row.key, (keyCounts.get(row.key) || 0) + 1));
    rows.forEach(row => {
      Object.assign(row,evaluateEligibility(row,row.laneSettings,keyCounts.get(row.key) > 1));
      row.penalty = !row.laneSettings.rankedMeasures.includes('correctives') ? 0 : row.missingRankedMeasures.includes('correctives') ? null : row.correctives * row.laneSettings.correctivePenalty;
    });
    const lanes = [];
    for (let lane = 1; lane <= 5; lane++) {
      const laneSettings = getLaneSettings(settings,lane), rankFields = laneSettings.rankedMeasures;
      const members = rows.filter(row => row.lane === lane);
      const eligible = members.filter(row => row.eligible);
      const excluded = members.filter(row => !row.eligible).sort((a,b) => a.name.localeCompare(b.name));
      for (const field of rankFields) {
        const descending = ['wipers','vaph','quality'].includes(field);
        const ranked = eligible.filter(row => !row.missingRankedMeasures.includes(field)).sort((a,b) => descending ? b[field] - a[field] : a[field] - b[field]);
        let rank = 0, last;
        ranked.forEach((row,index) => { if (index === 0 || row[field] !== last) rank = index + 1; row.ranks[field] = rank; last = row[field]; });
        eligible.filter(row => row.missingRankedMeasures.includes(field)).forEach(row => { row.ranks[field] = ranked.length + 1; });
      }
      const maximumCorrectivePenalty = rankFields.includes('correctives') ? Math.max(0,...eligible.filter(row => row.penalty != null).map(row => row.penalty)) : 0;
      eligible.forEach(row => {
        // An unavailable optional corrective count receives both last-place rank
        // points and the highest known eligible penalty in this lane. It must
        // not gain an advantage by avoiding a known corrective penalty.
        row.missingPenaltyAdjustment = rankFields.includes('correctives') && row.missingRankedMeasures.includes('correctives') ? maximumCorrectivePenalty : 0;
        row.total = rankFields.reduce((sum,field) => sum + row.ranks[field], 0) + (row.penalty || 0) + row.missingPenaltyAdjustment;
      });
      const ready = eligible.length > 0;
      members.forEach(row => { row.laneProvisional = !ready; });
      if (excluded.length) warnings.push('Lane ' + lane + ': ' + excluded.length + ' representative' + (excluded.length === 1 ? ' is' : 's are') + ' excluded from rankings because of missing or conflicting data.');
      if (!ready && members.length) warnings.push('Lane ' + lane + ': no eligible representatives are available to rank or select a winner.');
      const lowest = ready ? Math.min(...eligible.map(row => row.total)) : null;
      const ordered = eligible.slice().sort((a,b) => a.total - b.total || a.name.localeCompare(b.name));
      let laneRank = 0, lastTotal;
      ordered.forEach((row,index) => {
        if (index === 0 || row.total !== lastTotal) laneRank = index + 1;
        row.laneRank = laneRank; lastTotal = row.total;
        row.winner = row.total === lowest;
      });
      const threeSettings = normalizeLaneSettings(), strictSettings = normalizeLaneSettings({measures:MEASURES.map(measure => measure.id),requireAllWiperWeeks:true});
      const eligibleCount = comparison => members.filter(row => evaluateEligibility(row,comparison,keyCounts.get(row.key) > 1).eligible).length;
      const threeMetricEligible = eligibleCount(threeSettings), strictEligible = eligibleCount(strictSettings);
      lanes.push({lane, settings:laneSettings, ready, provisional:!ready, count:members.length, eligibleCount:eligible.length, excludedCount:excluded.length,
        exclusionSummary:summarizeExclusions(excluded),
        eligibilityComparison:{currentEligible:eligible.length,threeMetricEligible,strictEligible,recoveredByThreeMetrics:threeMetricEligible - strictEligible},
        winners:ordered.filter(row => row.winner), rankedRows:ordered, excludedRows:excluded, rows:[...ordered,...excluded]});
    }
    const rankedRows = lanes.flatMap(lane => lane.rankedRows), excludedRows = lanes.flatMap(lane => lane.excludedRows);
    const threeMetricEligible = lanes.reduce((sum,lane) => sum + lane.eligibilityComparison.threeMetricEligible,0);
    const strictEligible = lanes.reduce((sum,lane) => sum + lane.eligibilityComparison.strictEligible,0);
    return {month, settings, rows:lanes.flatMap(lane => lane.rows), rankedRows, excludedRows, lanes, winners:rankedRows.filter(row => row.winner), warnings,
      exclusionSummary:summarizeExclusions(excludedRows),
      eligibilityComparison:{currentEligible:rankedRows.length,threeMetricEligible,strictEligible,recoveredByThreeMetrics:threeMetricEligible - strictEligible},
      stats:{totalRows:rows.length,eligibleRows:rankedRows.length,excludedRows:excludedRows.length,readyLanes:lanes.filter(lane => lane.ready).length}};
  }
  const api = {MEASURES,normalizeSettings,normalizeLaneSettings,getLaneSettings,normalizeName, nameKey:normalizeName, previousMonth, selectMonthSheet, workbookSheets, parseMonthly, parseLane3, buildReport};
  root.VerificationAllStarCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
