(function installPerformanceScorecardUploadMode(root) {
  'use strict';

  const VERSION = '1.1.0';
  const doc = root.document || null;
  const DAY = 86400000;
  const HEADER_SCAN_LIMIT = 250;
  const COLUMN_PREF_KEY = 'coachtools.performanceScorecard.workbookColumns.v1';
  const moduleScriptUrl = (() => {
    try { return doc && doc.currentScript && doc.currentScript.src ? new URL(doc.currentScript.src, root.location.href) : null; }
    catch (_) { return null; }
  })();

  const DIRECT_NAME_FIELDS = [
    'Agent Name', 'Agent_Name', 'AgentName', 'Representative', 'Representative Name',
    'Associate Name', 'Associate', 'Employee Name', 'Employee', 'Rep Name', 'Rep',
    'CSR Name', 'SSR Name', 'Name'
  ];
  const FIRST_NAME_FIELDS = [
    'First Name', 'FIRST_NAME', 'First_Name', 'Agent First Name', 'Agent_FirstName',
    'Agent Firstname', 'Agent_Firstname', 'Agent First', 'Given Name', 'Given_Name'
  ];
  const LAST_NAME_FIELDS = [
    'Last Name', 'LAST_NAME', 'Last_Name', 'Surname', 'Agent Surname', 'Agent_surname',
    'Agent Last Name', 'Agent_LastName', 'Agent Lastname', 'Agent_Lastname', 'Family Name', 'Family_Name'
  ];
  const COACH_FIELDS = [
    'Job Coach', 'Coach Assigned', 'Coach', 'Coach Name', 'Coach_Name',
    'Supervisor', 'Supervisor Name', 'Supervisor_Name',
    'Team Name', 'Team_Name', 'Team'
  ];
  const DATE_FIELDS = [
    'Date', 'Business Date', 'Reporting Date', 'Report Date', 'Work Date', 'Call Date',
    'Interaction Date', 'Week', 'Week Start', 'Week Starting', 'Week Beginning',
    'Week End', 'Week Ending', 'Period Start', 'Period End'
  ];
  const METRIC_DEFS = Object.freeze({
    consumer: { label: 'Consumer AR', department: 'Retail' },
    insurance: { label: 'Insurance AR', department: 'Retail' },
    commercial: { label: 'Commercial AR', department: 'Retail' },
    referral: { label: 'Referral AR', department: 'Referral' },
    wiper: { label: 'Wiper Rate', department: 'Both' }
  });
  const DEFAULT_COLUMNS = Object.freeze({ consumer: true, insurance: true, commercial: true, referral: true, wiper: true, coverage: true });

  function loadColumnPrefs() {
    try {
      const parsed = JSON.parse(root.localStorage?.getItem(COLUMN_PREF_KEY) || '{}');
      return { ...DEFAULT_COLUMNS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (_) { return { ...DEFAULT_COLUMNS }; }
  }
  function saveColumnPrefs(columns) {
    try { root.localStorage?.setItem(COLUMN_PREF_KEY, JSON.stringify(columns)); } catch (_) {}
  }

  const state = {
    workbook: null,
    fileName: '',
    sheets: [],
    latestDate: null,
    window: null,
    currentRows: [],
    diagnostics: null,
    sort: { key: 'name', dir: 1 },
    search: '',
    columns: loadColumnPrefs()
  };
  const lookupCache = new WeakMap();
  const scriptPromises = new Map();

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }
  function normalizeHeader(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
  }
  function normalizeName(value) {
    return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normalizePersonDisplay(value) {
    const raw = clean(value);
    if (!raw) return '';
    const noEmail = raw.includes('@') && !raw.includes(' ') ? raw.split('@')[0].replace(/[._-]+/g, ' ') : raw;
    const comma = noEmail.match(/^\s*([^,]+),\s*(.+?)\s*$/);
    return clean(comma ? `${comma[2]} ${comma[1]}` : noEmail);
  }
  function parseNumber(value) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const raw = clean(value), number = Number(raw.replace(/[$,%]/g, '').replace(/,/g, ''));
    if (!Number.isFinite(number)) return NaN;
    return raw.includes('%') ? number / 100 : number;
  }
  function parseDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 0 && value < 100000) {
        const d = new Date(Date.UTC(1899, 11, 30) + value * DAY);
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      if (value > 1e11) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
    }
    const raw = clean(value);
    if (!raw) return null;
    const iso = raw.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) {
      const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const us = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    if (us) {
      let year = Number(us[3]);
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      const d = new Date(year, Number(us[1]) - 1, Number(us[2]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const shortRange = raw.match(/^\s*(\d{1,2})[/-](\d{1,2})\s*[-–]\s*\d{1,2}[/-]\d{1,2}\s*$/);
    if (shortRange) {
      const d = new Date(new Date().getFullYear(), Number(shortRange[1]) - 1, Number(shortRange[2]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function startOfSunday(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - d.getDay());
    return d;
  }
  function dayKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function threeWeekWindow(latestDate) {
    const latestWeek = startOfSunday(latestDate);
    if (!latestWeek) return null;
    const start = new Date(latestWeek.getTime() - 14 * DAY), end = new Date(latestWeek.getTime() + 6 * DAY);
    return { start, end, latestWeek, startKey: dayKey(start), endKey: dayKey(end) };
  }
  function formatDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }
  function formatPercent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'; }
  function formatInt(value) { return Number.isFinite(value) ? Math.round(value).toLocaleString() : '—'; }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function rowLookup(row) {
    if (!row || typeof row !== 'object') return { map: new Map(), keys: [] };
    const cached = lookupCache.get(row);
    if (cached) return cached;
    const keys = Object.keys(row), map = new Map();
    for (const key of keys) {
      const normalized = normalizeHeader(key);
      if (normalized && !map.has(normalized)) map.set(normalized, key);
    }
    const result = { map, keys };
    lookupCache.set(row, result);
    return result;
  }
  function pick(row, aliases, patterns) {
    const lookup = rowLookup(row);
    for (const alias of aliases || []) {
      const key = lookup.map.get(normalizeHeader(alias));
      if (key != null) return row[key];
    }
    for (const key of lookup.keys) {
      const normalized = normalizeHeader(key);
      if ((patterns || []).some(pattern => pattern.test(normalized))) return row[key];
    }
    return undefined;
  }
  function hasField(row, aliases, patterns) {
    const lookup = rowLookup(row);
    for (const alias of aliases || []) if (lookup.map.has(normalizeHeader(alias))) return true;
    return lookup.keys.some(key => (patterns || []).some(pattern => pattern.test(normalizeHeader(key))));
  }
  function nameFromRow(row) {
    const direct = normalizePersonDisplay(pick(row, DIRECT_NAME_FIELDS, [/^agentname$/, /^representativename$/, /^associatename$/, /^employeename$/, /^repname$/, /^csrname$/, /^ssrname$/, /^name$/]));
    if (direct) return direct;
    const first = clean(pick(row, FIRST_NAME_FIELDS, [/^(agent)?first(name)?$/, /^given(name)?$/]));
    const last = clean(pick(row, LAST_NAME_FIELDS, [/^(agent)?last(name)?$/, /surname$/, /familyname$/]));
    return clean([first, last].filter(Boolean).join(' '));
  }
  function coachFromRow(row) {
    return normalizePersonDisplay(pick(row, COACH_FIELDS, [/jobcoach/, /^coach(name)?$/, /coachassigned/, /^supervisor(name)?$/, /^team(name)?$/]));
  }
  function dateFromRow(row) {
    return parseDate(pick(row, DATE_FIELDS, [/(business|reporting|report|work|call|interaction)?date$/, /^week(start|starting|beginning|end|ending)?$/, /^period(start|end)$/]));
  }
  function classifySheet(name) {
    const n = normalizeHeader(name);
    if (!n) return '';
    if (n.includes('wiper')) return 'wiper';
    if (n.includes('phonedata') || (n.includes('phone') && n.includes('data'))) return 'phone';
    if (n.includes('sv2') || n.includes('salesview2') || n.includes('salesview')) return 'sv2';
    if (n.includes('retailweekly') || n.includes('referralweekly')) return 'sv2';
    return '';
  }
  function headerSignals(values) {
    const headers = (values || []).map(normalizeHeader).filter(Boolean), has = pattern => headers.some(value => pattern.test(value));
    const hasName = has(/^agentname$|^representativename$|^associatename$|^employeename$|^name$/) || (has(/firstname|agentfirst|givenname/) && has(/lastname|agentlast|surname|familyname/));
    const hasId = has(/^emplid$|^employeeid$|^agentid$|^phoneid$|^avayaid$/);
    const hasRetailKpi = has(/^(cash|consumer|insurance|commercial).*(opps?|opportunities?|apps?|appts?|appointments?)$/) || has(/^(cash|consumer|insurance|commercial).*(appointment|appt).*rate$/);
    const hasReferralKpi = has(/^referral.*(opps?|opportunities?|apps?|appts?|appointments?)$/) || has(/^referral.*(appointment|appt).*rate$/);
    const hasWiper = has(/wiper/) || (has(/^accepted$/) && (has(/^declined$/) || has(/^asked$/)));
    const hasPhone = has(/phone|avaya|call/);
    return { headers, has, hasName, hasId, hasRetailKpi, hasReferralKpi, hasWiper, hasPhone };
  }
  function classifyHeader(values, sheetName) {
    const s = headerSignals(values), named = classifySheet(sheetName);
    if (named === 'wiper' && s.hasWiper) return 'wiper';
    if ((s.hasRetailKpi || s.hasReferralKpi) && (s.hasName || s.hasId)) return 'sv2';
    if (s.hasWiper && (s.hasName || s.hasId)) return 'wiper';
    if (named === 'phone' && (s.hasName || s.hasId || s.hasPhone)) return 'phone';
    return '';
  }
  function classifySheetFromMatrix(name, matrix) {
    const byName = classifySheet(name);
    let bestKind = '', bestScore = -1;
    for (let i = 0; i < Math.min(HEADER_SCAN_LIMIT, (matrix || []).length); i++) {
      const kind = classifyHeader(matrix[i], name) || byName;
      if (!kind) continue;
      const score = headerScore(matrix[i], kind);
      if (score > bestScore) { bestScore = score; bestKind = kind; }
    }
    return bestKind || byName;
  }
  function inferSheetDepartment(name, headers, kind) {
    const n = normalizeHeader(name), s = headerSignals(headers);
    if (n.includes('referral')) return 'Referral';
    if (n.includes('retail')) return 'Retail';
    if (s.hasReferralKpi && !s.hasRetailKpi) return 'Referral';
    if (s.hasRetailKpi) return 'Retail';
    if (kind === 'phone') return 'Both';
    if (kind === 'wiper') return 'Retail';
    return 'Both';
  }
  function sheetMatchesDepartment(sheet, department) {
    return !sheet?.department || sheet.department === 'Both' || sheet.department === department;
  }
  function headerScore(values, kind) {
    const headers = (values || []).map(normalizeHeader).filter(Boolean), has = pattern => headers.some(value => pattern.test(value));
    if (!headers.length) return -1;
    let score = 0;
    if (has(/^agentname$|^representativename$|^associatename$|^employeename$|^name$/)) score += 6;
    if (has(/firstname|agentfirst|givenname/) && has(/lastname|agentlast|surname|familyname/)) score += 7;
    if (has(/^emplid$|^employeeid$|^agentid$|^phoneid$|^avayaid$/)) score += 4;
    if (has(/date|week/)) score += 2;
    if (has(/coach|supervisor|teamname|^team$/)) score += 2;
    if (kind === 'sv2' && has(/cash|consumer|insurance|commercial|referral/)) score += 5;
    if (kind === 'wiper' && has(/wiper|accept|declin|asked|jobs|count/)) score += 5;
    if (kind === 'phone' && has(/phone|call|agent|coach/)) score += 3;
    return score;
  }
  function findHeaderRow(matrix, kind) {
    let bestIndex = 0, bestScore = -1;
    for (let i = 0; i < Math.min(HEADER_SCAN_LIMIT, (matrix || []).length); i++) {
      const score = headerScore(matrix[i], kind);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    return bestIndex;
  }
  function rowsFromMatrix(matrix, headerIndex) {
    const rawHeaders = (matrix[headerIndex] || []).map((value, index) => clean(value) || `Column ${index + 1}`), headers = [], seen = new Map();
    for (const raw of rawHeaders) {
      const count = seen.get(raw) || 0;
      seen.set(raw, count + 1);
      headers.push(count ? `${raw} (${count + 1})` : raw);
    }
    const rows = [];
    for (let i = headerIndex + 1; i < matrix.length; i++) {
      const values = matrix[i] || [];
      if (!values.some(value => clean(value) !== '')) continue;
      const row = {};
      for (let c = 0; c < headers.length; c++) row[headers[c]] = values[c] == null ? '' : values[c];
      rows.push(row);
    }
    return { headers, rows };
  }

  function numericField(row, aliases, patterns) { return parseNumber(pick(row, aliases, patterns)); }
  function ratioPair(row, numeratorAliases, denominatorAliases, numeratorPatterns, denominatorPatterns) {
    const num = numericField(row, numeratorAliases, numeratorPatterns), den = numericField(row, denominatorAliases, denominatorPatterns);
    return Number.isFinite(num) && Number.isFinite(den) && den > 0 ? { num, den, value: num / den } : null;
  }
  function directRate(row, aliases, patterns) {
    let value = numericField(row, aliases, patterns);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) > 1.5) value /= 100;
    return { num: NaN, den: NaN, value };
  }
  function appointmentMetrics(row, department) {
    const out = {};
    if (department === 'Retail') {
      out.consumer = ratioPair(row,
        ['Cash Apps', 'Cash Appointments', 'Consumer Apps', 'Consumer Appointments', 'Consumer Appointment'],
        ['Cash Opps', 'Cash Opportunities', 'Consumer Opps', 'Consumer Opportunities', 'Consumer Opportunity'],
        [/^(cash|consumer).*(apps|appts|appointments?)$/, /^(apps|appts|appointments?).*(cash|consumer)$/],
        [/^(cash|consumer).*(opps|opportunities?)$/, /^(opps|opportunities?).*(cash|consumer)$/]
      ) || directRate(row, ['Cash AR', 'CAR', 'Consumer AR', 'Consumer Appointment Rate', 'Cash Appointment Rate'], [/(cash|consumer).*(appointment|appt).*rate/, /^car$/]);
      out.insurance = ratioPair(row,
        ['Insurance Apps', 'Insurance Appts', 'Insurance Appointments', 'Insurance Appointment'],
        ['Insurance Opps', 'Insurance Opportunities', 'Insurance Opportunity'],
        [/^insurance.*(apps|appts|appointments?)$/], [/^insurance.*(opps|opportunities?)$/]
      ) || directRate(row, ['Insurance AR', 'Insurance Appointment Rate'], [/insurance.*(appointment|appt).*rate/, /^insurancear$/]);
      out.commercial = ratioPair(row,
        ['Commercial Apps', 'Commercial Appts', 'Commercial Appointments', 'Commercial Appointment'],
        ['Commercial Opps', 'Commercial Opportunities', 'Commercial Opportunity'],
        [/^commercial.*(apps|appts|appointments?)$/], [/^commercial.*(opps|opportunities?)$/]
      ) || directRate(row, ['Commercial AR', 'Commercial Appointment Rate'], [/commercial.*(appointment|appt).*rate/, /^commercialar$/]);
    } else {
      out.referral = ratioPair(row,
        ['Referral Apps', 'Referral Appts', 'Referral Appointments', 'Referral Appointment'],
        ['Referral Opps', 'Referral Opportunities', 'Referral Opportunity'],
        [/^referral.*(apps|appts|appointments?)$/], [/^referral.*(opps|opportunities?)$/]
      ) || directRate(row, ['Referral AR', 'Referral Appointment Rate'], [/referral.*(appointment|appt).*rate/, /^referralar$/]);
    }
    return out;
  }
  function wiperMetric(row, department) {
    const countJobs = ratioPair(row,
      ['Wiper Count', 'Wipers Count', 'Wiper Accepted Count'], ['Wiper Jobs', 'Wiper Job', 'Wiper Eligible Jobs', 'Jobs'],
      [/^wipers?count$/, /^wiper.*acceptedcount$/], [/^wiper.*jobs?$/, /^jobs$/]);
    const acceptedAsked = ratioPair(row,
      ['Wipers Accepted', 'Wiper Accepted', 'Wipers Accept', 'Wiper Accept', 'Accepted'],
      ['Wipers Asked', 'Wiper Asked', 'Asked', 'Wiper Offers', 'Wipers Offered'],
      [/wipers?.*accept/, /^accepted$/], [/wipers?.*asked/, /^asked$/, /wipers?.*offer/]);
    const accepted = numericField(row, ['Wipers Accepted', 'Wiper Accepted', 'Wipers Accept', 'Wiper Accept', 'Accepted'], [/wipers?.*accept/, /^accepted$/]);
    const declined = numericField(row, ['Wipers Declined', 'Wiper Declined', 'Declined', 'Wiper Declines'], [/wipers?.*declin/, /^declined$/]);
    const acceptedDeclined = Number.isFinite(accepted) && Number.isFinite(declined) && accepted + declined > 0 ? { num: accepted, den: accepted + declined, value: accepted / (accepted + declined) } : null;
    const direct = directRate(row, ['Wiper Rate', 'Wipers Rate'], [/wipers?.*rate/]);
    return department === 'Referral' ? (acceptedAsked || acceptedDeclined || countJobs || direct) : (countJobs || acceptedDeclined || acceptedAsked || direct);
  }
  function metricsFromRow(row, department, kind) {
    const out = {};
    if (kind === 'sv2' || kind === 'phone') Object.assign(out, appointmentMetrics(row, department));
    if (kind === 'wiper') {
      const wiper = wiperMetric(row, department);
      if (wiper) out.wiper = wiper;
    }
    return out;
  }
  function sheetHasDateField(rows) {
    const sample = (rows || []).slice(0, 100);
    return sample.some(row => hasField(row, DATE_FIELDS, [/date$/, /^week/, /^period/])) && sample.some(row => dateFromRow(row));
  }
  function inWindow(row, sheet, windowSpec) {
    if (!windowSpec) return true;
    if (!sheet.hasDates) return true;
    return Boolean(row.__date && row.__date >= windowSpec.start && row.__date <= windowSpec.end);
  }
  function sourcePriority(kind, metric) {
    if (metric === 'wiper') return kind === 'wiper' ? 30 : 5;
    return kind === 'sv2' ? 30 : kind === 'phone' ? 10 : 5;
  }
  function addMetricBucket(map, key, metric, sourceKind) {
    const bucketKey = `${key}|${metric}|${sourceKind}`;
    if (!map.has(bucketKey)) map.set(bucketKey, { metric, sourceKind, num: 0, den: 0, weighted: false, values: [] });
    return map.get(bucketKey);
  }
  function addMetricValue(bucket, value) {
    if (!value || !Number.isFinite(value.value)) return;
    if (Number.isFinite(value.num) && Number.isFinite(value.den) && value.den > 0) {
      bucket.num += value.num; bucket.den += value.den; bucket.weighted = true;
    } else bucket.values.push(value.value);
  }
  function finalizeBucket(bucket) {
    if (bucket.weighted && bucket.den > 0) return { num: bucket.num, den: bucket.den, value: bucket.num / bucket.den, sourceKind: bucket.sourceKind };
    const values = bucket.values.filter(Number.isFinite);
    return values.length ? { num: NaN, den: NaN, value: values.reduce((sum, value) => sum + value, 0) / values.length, sourceKind: bucket.sourceKind } : null;
  }
  function chooseBestMetric(candidates, metric) {
    return (candidates || []).filter(Boolean).sort((a, b) => sourcePriority(b.sourceKind, metric) - sourcePriority(a.sourceKind, metric))[0] || null;
  }

  function aggregateWorkbook(parsedSheets, department, selectedCoach, windowSpec, currentVisibleNames) {
    const allWindowRows = [], allNames = new Map(), explicitCoachNames = new Set(), coachKey = normalizeName(selectedCoach);
    let coachFieldsObserved = 0;
    for (const sheet of parsedSheets) {
      if (!sheetMatchesDepartment(sheet, department)) continue;
      for (const row of sheet.rows) {
        if (!inWindow(row, sheet, windowSpec)) continue;
        const name = row.__name || nameFromRow(row), key = normalizeName(name);
        if (!key) continue;
        if (!allNames.has(key)) allNames.set(key, name);
        const coach = row.__coach || coachFromRow(row);
        if (coach) coachFieldsObserved++;
        if (coachKey && coachKey !== '__all__' && normalizeName(coach) === coachKey) explicitCoachNames.add(key);
        allWindowRows.push({ sheet, row, name, key });
      }
    }

    let rosterKeys = new Set(allNames.keys()), rosterSource = 'all names in the workbook window';
    if (coachKey && coachKey !== '__all__') {
      if (explicitCoachNames.size) {
        rosterKeys = explicitCoachNames;
        rosterSource = `rows explicitly assigned to ${selectedCoach}`;
      } else {
        const visible = new Set((currentVisibleNames || []).map(normalizeName).filter(Boolean));
        const fallback = new Set([...allNames.keys()].filter(key => visible.has(key)));
        if (fallback.size) {
          rosterKeys = fallback;
          rosterSource = 'current Scorecard roster fallback because the workbook did not expose a matching coach/team field';
        }
      }
    }

    const buckets = new Map(), displayNames = new Map();
    for (const item of allWindowRows) {
      if (!rosterKeys.has(item.key)) continue;
      displayNames.set(item.key, displayNames.get(item.key) || item.name);
      const week = item.row.__date ? dayKey(startOfSunday(item.row.__date)) : 'undated';
      const metrics = metricsFromRow(item.row, department, item.sheet.kind);
      for (const [metric, value] of Object.entries(metrics)) {
        if (!value || !Number.isFinite(value.value)) continue;
        addMetricValue(addMetricBucket(buckets, `${item.key}|${week}`, metric, item.sheet.kind), value);
      }
    }

    const selected = new Map();
    for (const [bucketKey, bucket] of buckets) {
      const parts = bucketKey.split('|'), sourceKind = parts.pop(), metric = parts.pop(), repWeekKey = parts.join('|'), baseKey = `${repWeekKey}|${metric}`;
      if (!selected.has(baseKey)) selected.set(baseKey, []);
      const value = finalizeBucket(bucket);
      if (value) selected.get(baseKey).push({ ...value, sourceKind });
    }

    const reps = new Map();
    for (const [baseKey, candidates] of selected) {
      const parts = baseKey.split('|'), metric = parts.pop(), week = parts.pop(), repKey = parts.join('|'), value = chooseBestMetric(candidates, metric);
      if (!value) continue;
      if (!reps.has(repKey)) reps.set(repKey, { key: repKey, name: displayNames.get(repKey) || allNames.get(repKey) || repKey, metrics: {}, weeks: new Set() });
      const rep = reps.get(repKey);
      if (!rep.metrics[metric]) rep.metrics[metric] = { points: [] };
      rep.metrics[metric].points.push({ week, ...value });
      if (week !== 'undated') rep.weeks.add(week);
    }
    for (const key of rosterKeys) if (!reps.has(key)) reps.set(key, { key, name: displayNames.get(key) || allNames.get(key) || key, metrics: {}, weeks: new Set() });

    const rows = [...reps.values()].map(rep => {
      for (const data of Object.values(rep.metrics)) {
        data.points.sort((a, b) => String(a.week).localeCompare(String(b.week)));
        const weighted = data.points.filter(point => Number.isFinite(point.num) && Number.isFinite(point.den) && point.den > 0);
        if (weighted.length) {
          data.num = weighted.reduce((sum, point) => sum + point.num, 0);
          data.den = weighted.reduce((sum, point) => sum + point.den, 0);
          data.value = data.den ? data.num / data.den : NaN;
        } else {
          const values = data.points.map(point => point.value).filter(Number.isFinite);
          data.num = NaN; data.den = NaN; data.value = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
        }
        const dated = data.points.filter(point => point.week !== 'undated' && Number.isFinite(point.value));
        data.trend = dated.length >= 2 ? dated[dated.length - 1].value - dated[0].value : NaN;
        data.coverage = new Set(dated.map(point => point.week)).size;
        data.sourceKinds = [...new Set(data.points.map(point => point.sourceKind))];
      }
      return rep;
    });

    return {
      rows,
      diagnostics: {
        allNames: allNames.size,
        rosterNames: rosterKeys.size,
        matchedNames: rows.filter(row => Object.keys(row.metrics).length).length,
        namesWithoutMetrics: rows.filter(row => !Object.keys(row.metrics).length).length,
        coachFieldsObserved,
        rosterSource,
        coachMatchCount: explicitCoachNames.size,
        rowsInWindow: allWindowRows.length
      }
    };
  }

  function currentVisibleRepresentativeNames() {
    return doc ? [...doc.querySelectorAll('#tableBody .repBtn')].map(node => clean(node.textContent)).filter(Boolean) : [];
  }
  function currentScorecardCoachLabel() {
    if (!doc) return '';
    const select = doc.getElementById('coachSel');
    return select && select.value && select.value !== '__ALL__' ? clean(select.options[select.selectedIndex] && select.options[select.selectedIndex].textContent) : '';
  }
  function currentScorecardDepartment() {
    if (!doc) return 'Retail';
    return doc.getElementById('departmentSel')?.value === 'Referral' ? 'Referral' : 'Retail';
  }
  function sheetSummaryText(sheet) {
    const department = sheet.department && sheet.department !== 'Both' ? ` · ${sheet.department}` : '';
    return `${sheet.name}${department} · ${sheet.rows.length.toLocaleString()} rows${sheet.hasDates ? '' : ' · no usable date field'}`;
  }
  async function nextPaint() {
    await new Promise(resolve => root.requestAnimationFrame ? root.requestAnimationFrame(resolve) : setTimeout(resolve, 0));
  }
  async function ensureXlsx() {
    if (root.XLSX) return root.XLSX;
    if (!doc) throw new Error('SheetJS requires a browser document.');
    const source = moduleScriptUrl ? new URL('../vendor/xlsx.full.min.js', moduleScriptUrl).href : '../vendor/xlsx.full.min.js';
    const existing = [...doc.scripts].find(script => script.src === source);
    await new Promise((resolve, reject) => {
      if (root.XLSX) return resolve();
      const script = existing || doc.createElement('script');
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error('Could not load the local Excel reader.')), { once: true });
      if (!existing) {
        script.src = source;
        script.async = true;
        script.dataset.scorecardWorkbookDependency = 'xlsx';
        doc.head.appendChild(script);
      }
    });
    if (!root.XLSX) throw new Error('The local Excel reader loaded without exposing XLSX.');
    return root.XLSX;
  }
  function loadScript(source, ready) {
    if (ready()) return Promise.resolve();
    if (scriptPromises.has(source)) return scriptPromises.get(source);
    const promise = new Promise((resolve, reject) => {
      const existing = [...doc.scripts].find(script => script.src === source);
      const script = existing || doc.createElement('script');
      script.addEventListener('load', () => ready() ? resolve() : reject(new Error(`Loaded ${source} but the export library was unavailable.`)), { once: true });
      script.addEventListener('error', () => reject(new Error(`Could not load ${source}.`)), { once: true });
      if (!existing) { script.src = source; script.async = true; doc.head.appendChild(script); }
    });
    scriptPromises.set(source, promise);
    return promise;
  }
  async function ensureHtml2Canvas() {
    if (!doc) throw new Error('Workbook Snip requires a browser document.');
    const source = moduleScriptUrl ? new URL('../vendor/html2canvas.min.js', moduleScriptUrl).href : '../vendor/html2canvas.min.js';
    await loadScript(source, () => typeof root.html2canvas === 'function');
    return root.html2canvas;
  }
  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create workbook image.')), 'image/png'));
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), anchor = doc.createElement('a');
    anchor.href = url; anchor.download = name; doc.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  async function snipWorkbook(button) {
    const target = doc?.querySelector('#psUploadOverlay .psUploadShell'), overlay = doc?.getElementById('psUploadOverlay'), wrap = doc?.querySelector('.psUploadTableWrap'), table = wrap?.querySelector('table');
    if (!target || !overlay || !wrap || !table) throw new Error('Workbook scorecard is not ready to snip.');
    const old = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Snipping…'; }
    try {
      const html2canvas = await ensureHtml2Canvas();
      const exportWidth = Math.ceil(Math.max(target.getBoundingClientRect().width, target.scrollWidth, table.scrollWidth + 28));
      const estimatedHeight = Math.ceil(target.scrollHeight + Math.max(0, wrap.scrollHeight - wrap.clientHeight));
      const scale = Math.max(.72, Math.min(2, Math.sqrt(28000000 / Math.max(1, exportWidth * estimatedHeight))));
      overlay.classList.add('psUploadExportSafe');
      let canvas;
      try {
        canvas = await html2canvas(target, {
          backgroundColor: null,
          scale,
          useCORS: true,
          logging: false,
          windowWidth: Math.max(doc.documentElement.clientWidth, exportWidth),
          windowHeight: Math.max(doc.documentElement.clientHeight, estimatedHeight),
          onclone: cloned => {
            const clonedOverlay = cloned.getElementById('psUploadOverlay'), clonedTarget = cloned.querySelector('#psUploadOverlay .psUploadShell'), clonedWrap = cloned.querySelector('.psUploadTableWrap'), clonedTable = clonedWrap?.querySelector('table');
            clonedOverlay?.classList.add('psUploadExportSafe');
            if (clonedTarget) { clonedTarget.style.width = `${exportWidth}px`; clonedTarget.style.maxWidth = 'none'; clonedTarget.style.margin = '0'; }
            if (clonedWrap) { clonedWrap.style.maxHeight = 'none'; clonedWrap.style.overflow = 'visible'; }
            if (clonedTable) { clonedTable.style.width = '100%'; clonedTable.style.minWidth = `${Math.max(860, table.scrollWidth)}px`; }
            cloned.getElementById('psUploadColumns')?.removeAttribute('open');
          }
        });
      } finally { overlay.classList.remove('psUploadExportSafe'); }
      const department = clean(doc.getElementById('psUploadDepartment')?.value || 'workbook').toLowerCase();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(await canvasBlob(canvas), `performance-scorecard-workbook-${department}-${stamp}.png`);
    } finally {
      if (button) { button.disabled = false; button.textContent = old || '✂ Snip'; }
    }
  }

  function setProgress(percent, label, detail) {
    if (!doc) return;
    doc.getElementById('psUploadProgress')?.classList.remove('hide');
    const fill = doc.getElementById('psUploadProgressFill'), pct = doc.getElementById('psUploadProgressPct'), text = doc.getElementById('psUploadProgressLabel'), sub = doc.getElementById('psUploadProgressDetail');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (pct) pct.textContent = `${Math.round(percent)}%`;
    if (text) text.textContent = label || 'Working…';
    if (sub) sub.textContent = detail || '';
  }
  function hideProgress() { doc?.getElementById('psUploadProgress')?.classList.add('hide'); }
  function setError(message) {
    if (!doc) return;
    const box = doc.getElementById('psUploadError');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('hide', !message);
  }
  function metricCell(metric) {
    if (!metric || !Number.isFinite(metric.value)) return '<span class="psUploadMuted">—</span>';
    const volume = Number.isFinite(metric.num) && Number.isFinite(metric.den) ? `${formatInt(metric.num)} / ${formatInt(metric.den)}` : 'direct rate';
    const trend = Number.isFinite(metric.trend) ? `${metric.trend >= 0 ? '▲' : '▼'} ${Math.abs(metric.trend * 100).toFixed(1)} pp` : 'No trend';
    const trendClass = Number.isFinite(metric.trend) ? (metric.trend >= 0 ? 'good' : 'bad') : 'psUploadMuted';
    const weeks = metric.points.filter(point => point.week !== 'undated').map(point => `${point.week.slice(5)} ${formatPercent(point.value)}`);
    return `<div class="psUploadMetricMain">${formatPercent(metric.value)}</div><div class="psUploadMetricSub">${escapeHtml(volume)}</div><div class="psUploadMetricSub ${trendClass}">${escapeHtml(trend)}</div>${weeks.length ? `<div class="psUploadWeeks">${weeks.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>` : ''}`;
  }
  function availableMetrics(department, rows) {
    const preferred = department === 'Retail' ? ['consumer', 'insurance', 'commercial', 'wiper'] : ['referral', 'wiper'];
    return preferred.filter(metric => rows.some(row => row.metrics[metric] && Number.isFinite(row.metrics[metric].value)));
  }
  function visibleMetrics(department, rows) {
    return availableMetrics(department, rows).filter(metric => state.columns[metric] !== false);
  }
  function teamMetric(rows, metric) {
    const values = rows.map(row => row.metrics[metric]).filter(item => item && Number.isFinite(item.value)), weighted = values.filter(item => Number.isFinite(item.num) && Number.isFinite(item.den) && item.den > 0);
    if (weighted.length) {
      const num = weighted.reduce((sum, item) => sum + item.num, 0), den = weighted.reduce((sum, item) => sum + item.den, 0);
      return { value: den ? num / den : NaN, num, den };
    }
    return { value: values.length ? values.reduce((sum, item) => sum + item.value, 0) / values.length : NaN, num: NaN, den: NaN };
  }
  function filteredSortedRows(rows) {
    const query = normalizeName(state.search), filtered = query ? rows.filter(row => normalizeName(row.name).includes(query)) : rows.slice(), key = state.sort.key, dir = state.sort.dir;
    return filtered.sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name) * dir;
      if (key === 'coverage') return (a.weeks.size - b.weeks.size) * dir;
      const av = a.metrics[key]?.value, bv = b.metrics[key]?.value;
      if (!Number.isFinite(av) && !Number.isFinite(bv)) return a.name.localeCompare(b.name);
      if (!Number.isFinite(av)) return 1;
      if (!Number.isFinite(bv)) return -1;
      return (av - bv) * dir;
    });
  }
  function renderColumnMenu(department, rows) {
    const menu = doc?.getElementById('psUploadColumnMenu');
    if (!menu) return;
    const candidates = department === 'Retail' ? ['consumer', 'insurance', 'commercial', 'wiper'] : ['referral', 'wiper'];
    const available = new Set(availableMetrics(department, rows));
    const parts = candidates.map(metric => `<label class="psUploadColumnRow"><input type="checkbox" data-ps-column="${metric}" ${state.columns[metric] !== false ? 'checked' : ''} ${available.has(metric) ? '' : 'disabled'}><span>${escapeHtml(METRIC_DEFS[metric].label)}</span><small>${available.has(metric) ? 'Workbook KPI' : 'No data found'}</small></label>`);
    parts.push(`<label class="psUploadColumnRow"><input type="checkbox" data-ps-column="coverage" ${state.columns.coverage !== false ? 'checked' : ''}><span>Coverage</span><small>Weeks matched</small></label>`);
    menu.innerHTML = parts.join('');
  }
  function renderResults(rows, diagnostics) {
    if (!doc) return;
    state.currentRows = rows; state.diagnostics = diagnostics;
    const department = doc.getElementById('psUploadDepartment').value, allMetrics = availableMetrics(department, rows), metrics = visibleMetrics(department, rows), filtered = filteredSortedRows(rows), showCoverage = state.columns.coverage !== false;
    renderColumnMenu(department, rows);
    const cards = [
      { label: 'Representatives', value: String(rows.length), sub: `${diagnostics.matchedNames} with matched KPI data` },
      ...allMetrics.map(metric => {
        const team = teamMetric(rows, metric);
        return { label: METRIC_DEFS[metric].label, value: formatPercent(team.value), sub: Number.isFinite(team.den) ? `${formatInt(team.num)} / ${formatInt(team.den)}` : 'Workbook rate average' };
      })
    ];
    doc.getElementById('psUploadSummary').innerHTML = cards.map(card => `<div class="psUploadSummaryCard"><div class="psUploadSummaryLabel">${escapeHtml(card.label)}</div><div class="psUploadSummaryValue">${escapeHtml(card.value)}</div><div class="psUploadSummarySub">${escapeHtml(card.sub)}</div></div>`).join('');
    const relevantSheets = state.sheets.filter(sheet => sheetMatchesDepartment(sheet, department)), found = relevantSheets.map(sheetSummaryText).join(' · '), windowText = state.window ? `${formatDate(state.window.start)} – ${formatDate(state.window.end)}` : 'No usable dates detected';
    doc.getElementById('psUploadMeta').innerHTML = `<b>${escapeHtml(state.fileName || 'Workbook')}</b> · ${escapeHtml(windowText)} · ${escapeHtml(diagnostics.rosterSource)}<br><span>${escapeHtml(found || 'No department-matched sheets')}</span>`;
    const warning = [];
    if (relevantSheets.some(sheet => !sheet.hasDates)) warning.push('Sheets without a usable date column are read in full unless Workbook Date supplies a week.');
    if (doc.getElementById('psUploadCoach').value !== '__ALL__' && !diagnostics.coachMatchCount) warning.push('No exact coach/team match was found; roster fallback was used.');
    warning.push('This live page reads the uploaded workbook only; stored Retail Weekly / Referral Weekly data and QA are not written or changed.');
    doc.getElementById('psUploadNotice').textContent = warning.join(' ');
    doc.getElementById('psUploadTableHead').innerHTML = `<tr><th data-ps-sort="name">Representative${state.sort.key === 'name' ? (state.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>${metrics.map(metric => `<th data-ps-sort="${metric}">${escapeHtml(METRIC_DEFS[metric].label)}${state.sort.key === metric ? (state.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}${showCoverage ? `<th data-ps-sort="coverage">Coverage${state.sort.key === 'coverage' ? (state.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>` : ''}</tr>`;
    const colspan = 1 + metrics.length + (showCoverage ? 1 : 0);
    doc.getElementById('psUploadTableBody').innerHTML = filtered.length ? filtered.map(row => `<tr><td><b>${escapeHtml(row.name)}</b></td>${metrics.map(metric => `<td>${metricCell(row.metrics[metric])}</td>`).join('')}${showCoverage ? `<td><b>${row.weeks.size}/3 weeks</b><div class="psUploadMetricSub">${Object.keys(row.metrics).length ? 'Matched' : 'No KPI rows matched'}</div></td>` : ''}</tr>`).join('') : `<tr><td colspan="${colspan}" class="psUploadEmpty">No representatives match this view.</td></tr>`;
    doc.getElementById('psUploadIntro')?.classList.add('hide');
    doc.getElementById('psUploadResults').classList.remove('hide');
  }
  function recompute() {
    if (!doc || !state.sheets.length) return;
    setError('');
    const department = doc.getElementById('psUploadDepartment').value, coachSelect = doc.getElementById('psUploadCoach');
    const selectedCoach = coachSelect.value === '__ALL__' ? '__ALL__' : coachSelect.options[coachSelect.selectedIndex].textContent;
    const result = aggregateWorkbook(state.sheets, department, selectedCoach, state.window, currentVisibleRepresentativeNames());
    renderResults(result.rows, result.diagnostics);
  }
  function populateCoachOptions() {
    if (!doc) return;
    const select = doc.getElementById('psUploadCoach'), currentKey = normalizeName(currentScorecardCoachLabel()), coaches = new Map(), department = doc.getElementById('psUploadDepartment')?.value || currentScorecardDepartment();
    for (const sheet of state.sheets) {
      if (!sheetMatchesDepartment(sheet, department)) continue;
      for (const row of sheet.rows) {
        if (!inWindow(row, sheet, state.window) || !row.__coach) continue;
        const key = normalizeName(row.__coach);
        if (key && !coaches.has(key)) coaches.set(key, row.__coach);
      }
    }
    const sorted = [...coaches].sort((a, b) => a[1].localeCompare(b[1]));
    select.innerHTML = `<option value="__ALL__">All coaches</option>` + sorted.map(([key, name]) => `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`).join('');
    if (currentKey && coaches.has(currentKey)) select.value = currentKey;
    else if (sorted.length === 1) select.value = sorted[0][0];
    else select.value = '__ALL__';
  }

  async function parseWorkbook(file) {
    if (!file) return;
    setError(''); state.fileName = file.name || 'Workbook';
    setProgress(5, 'Opening workbook…', 'Loading the local Excel reader');
    const XLSX = await ensureXlsx();
    await nextPaint(); setProgress(15, 'Reading Excel file…', state.fileName);
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: true });
    state.workbook = workbook;
    await nextPaint();
    const scanned = [];
    for (const name of workbook.SheetNames || []) {
      const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true, blankrows: false });
      const kind = classifySheetFromMatrix(name, matrix);
      if (kind) scanned.push({ name, kind, matrix });
    }
    const targets = scanned;
    if (!targets.length) throw new Error('No Retail/Referral KPI, Phone Data, SV2, or Wiper sheet could be identified from the workbook tabs or headers.');
    setProgress(28, 'Finding workbook pages…', targets.map(item => item.name).join(' · '));
    const parsed = [], dates = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      setProgress(32 + (38 * i / Math.max(1, targets.length)), `Reading ${target.name}…`, `Detecting headers, Team_Name, and representatives (${i + 1}/${targets.length})`);
      await nextPaint();
      const matrix = target.matrix, headerIndex = findHeaderRow(matrix, target.kind), converted = rowsFromMatrix(matrix, headerIndex), department = inferSheetDepartment(target.name, converted.headers, target.kind);
      for (const row of converted.rows) {
        row.__name = nameFromRow(row); row.__coach = coachFromRow(row); row.__date = dateFromRow(row);
        if (row.__date) dates.push(row.__date);
      }
      parsed.push({ name: target.name, kind: target.kind, department, headerIndex, headers: converted.headers, rows: converted.rows, hasDates: sheetHasDateField(converted.rows) });
    }
    state.sheets = parsed;
    state.latestDate = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
    state.window = threeWeekWindow(state.latestDate);
    setProgress(74, 'Matching representatives…', state.window ? `Last 3 business weeks: ${formatDate(state.window.start)} – ${formatDate(state.window.end)}` : 'No usable workbook dates detected');
    doc.getElementById('psUploadDepartment').value = currentScorecardDepartment();
    populateCoachOptions();
    await nextPaint(); setProgress(88, 'Aggregating KPI counts…', 'Using Cash Apps / Cash Opps and the matching Insurance, Commercial, Referral, and Wiper numerator/denominator fields');
    recompute();
    setProgress(100, 'Live workbook scorecard ready', `${parsed.length} scorecard-relevant sheets processed`);
    setTimeout(hideProgress, 350);
  }

  function injectStyles() {
    if (!doc || doc.getElementById('psUploadStyles')) return;
    const style = doc.createElement('style');
    style.id = 'psUploadStyles';
    style.textContent = `
#psUploadOverlay{position:fixed;inset:0;z-index:1950;background:var(--theme-bg,linear-gradient(160deg,var(--bg),var(--bg2)));color:var(--ink);overflow:auto;padding:14px}#psUploadOverlay.hide{display:none!important}.psUploadShell{max-width:1640px;margin:0 auto}.psUploadTop{position:sticky;top:0;z-index:8;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--panel) 96%,transparent);backdrop-filter:blur(16px);box-shadow:var(--shadow);padding:12px;margin-bottom:12px}.psUploadTitle{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.psUploadTitle h2{font-family:var(--font-display);margin:0;font-size:19px}.psUploadTitle p{margin:4px 0 0;color:var(--muted);font-size:10px;font-weight:750}.psUploadActions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.psUploadCtl{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:11px;background:var(--panel2);padding:5px 7px;min-height:38px}.psUploadCtl label{font-family:var(--font-display);font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:900}.psUploadCtl select,.psUploadCtl input{border:0;outline:0;background:transparent;color:var(--ink);font-size:11px;font-weight:850}.psUploadBtn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:11px;padding:8px 10px;font-family:var(--font-display);font-size:11px;font-weight:900;cursor:pointer;box-shadow:var(--soft-shadow)}.psUploadBtn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border-color:transparent}.psUploadIntro{border:1px solid var(--line);border-radius:18px;background:var(--panel);box-shadow:var(--shadow);padding:18px}.psUploadDrop{border:2px dashed color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:16px;background:var(--panel2);padding:28px;text-align:center}.psUploadDrop b{font-family:var(--font-display);font-size:16px}.psUploadDrop p{color:var(--muted);font-size:10px;margin:7px auto 13px;max-width:760px;line-height:1.5}.psUploadProgress{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:12px;margin-bottom:12px;box-shadow:var(--soft-shadow)}.psUploadProgress.hide{display:none}.psUploadTrack{height:10px;background:var(--panel2);border-radius:99px;overflow:hidden}.psUploadFill{height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--accent3));transition:width .18s ease}.psUploadProgressMeta{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:10px;font-weight:850}.psUploadProgressDetail{color:var(--muted);font-size:9px;margin-top:4px}.psUploadError{margin-bottom:12px;border:1px solid color-mix(in srgb,var(--bad) 65%,var(--line));border-radius:12px;background:color-mix(in srgb,var(--bad) 16%,var(--panel));color:var(--bad);padding:10px;font-size:10px;font-weight:850}.psUploadError.hide,.psUploadResults.hide{display:none}.psUploadSummary{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:8px;margin-bottom:10px}.psUploadSummaryCard{border:1px solid var(--line);border-radius:15px;background:var(--panel);box-shadow:var(--soft-shadow);padding:12px}.psUploadSummaryLabel{font-size:9px;color:var(--muted);font-family:var(--font-display);font-weight:900;text-transform:uppercase}.psUploadSummaryValue{font-size:23px;font-weight:950;margin-top:4px}.psUploadSummarySub{font-size:9px;color:var(--muted);font-weight:800;margin-top:3px}.psUploadNotice{border:1px solid color-mix(in srgb,var(--warn) 45%,var(--line));border-radius:11px;background:color-mix(in srgb,var(--warn) 11%,var(--panel));padding:9px 11px;font-size:9px;font-weight:800;margin-bottom:10px}.psUploadWorkspace{border:1px solid var(--line);border-radius:18px;background:var(--panel);box-shadow:var(--shadow);overflow:hidden}.psUploadWorkspaceHead{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;padding:11px 13px;border-bottom:1px solid var(--line);background:var(--panel2)}.psUploadWorkspaceTools{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.psUploadMeta{font-size:10px;color:var(--muted);font-weight:800;line-height:1.45}.psUploadTableWrap{overflow:auto;max-height:calc(100vh - 310px)}.psUploadTable{width:100%;border-collapse:separate;border-spacing:0;min-width:860px}.psUploadTable th,.psUploadTable td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:11px}.psUploadTable th{position:sticky;top:0;z-index:3;background:var(--panel2);font-family:var(--font-display);font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:900;cursor:pointer;white-space:nowrap}.psUploadTable tbody tr:hover td{background:var(--row-hover-bg)}.psUploadMetricMain{font-family:var(--font-numeric);font-size:15px;font-weight:950}.psUploadMetricSub{font-family:var(--font-numeric);font-size:8px;color:var(--muted);font-weight:850;margin-top:2px}.psUploadWeeks{display:flex;gap:3px;flex-wrap:wrap;margin-top:4px}.psUploadWeeks span{border:1px solid var(--line);border-radius:999px;background:var(--panel2);padding:2px 4px;font-family:var(--font-numeric);font-size:7px;font-weight:800}.psUploadMuted{color:var(--muted)}.psUploadEmpty{text-align:center;color:var(--muted);padding:24px!important}.psUploadFileInput{display:none}.psUploadColumns{position:relative}.psUploadColumns>summary{list-style:none}.psUploadColumns>summary::-webkit-details-marker{display:none}.psUploadColumnMenu{position:absolute;right:0;top:calc(100% + 6px);z-index:12;width:250px;border:1px solid var(--line);border-radius:13px;background:var(--panel);box-shadow:var(--shadow);padding:7px}.psUploadColumnRow{display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:center;padding:7px;border-radius:9px}.psUploadColumnRow:hover{background:var(--panel2)}.psUploadColumnRow input{grid-row:1/3}.psUploadColumnRow span{font-size:10px;font-weight:900}.psUploadColumnRow small{font-size:8px;color:var(--muted);font-weight:750}#psUploadOverlay.psUploadExportSafe .psUploadTop,#psUploadOverlay.psUploadExportSafe .psUploadDrop,#psUploadOverlay.psUploadExportSafe .psUploadError,#psUploadOverlay.psUploadExportSafe .psUploadNotice{background:var(--panel)!important;border-color:var(--line)!important;backdrop-filter:none!important}#psUploadOverlay.psUploadExportSafe .psUploadTable tbody tr:hover td{background:transparent!important}@media(max-width:1000px){.psUploadSummary{grid-template-columns:repeat(2,1fr)}}@media(max-width:680px){#psUploadOverlay{padding:6px}.psUploadSummary{grid-template-columns:1fr}.psUploadCtl{flex:1}.psUploadActions{width:100%}.psUploadColumnMenu{right:auto;left:0}}
`;
    doc.head.appendChild(style);
  }
  function overlayMarkup() {
    return `<div id="psUploadOverlay" class="hide"><div class="psUploadShell"><section class="psUploadTop"><div class="psUploadTitle"><div><h2>Live Workbook Scorecard</h2><p>Build a live scorecard directly from Retail / Referral workbook sheets without replacing stored CoachingTools weekly data.</p></div><div class="psUploadActions"><div class="psUploadCtl"><label>Department</label><select id="psUploadDepartment"><option value="Retail">Retail</option><option value="Referral">Referral</option></select></div><div class="psUploadCtl"><label>Coach</label><select id="psUploadCoach"><option value="__ALL__">All coaches</option></select></div><div class="psUploadCtl"><label>Find</label><input id="psUploadSearch" type="search" placeholder="Representative…" /></div><button class="psUploadBtn primary" id="psUploadChoose" type="button">Choose Excel</button><button class="psUploadBtn" id="psUploadClose" type="button">Back to Scorecard</button></div></div><input class="psUploadFileInput" id="psUploadFile" type="file" accept=".xlsx,.xls,.xlsm,.xlsb" /></section><div id="psUploadError" class="psUploadError hide"></div><div id="psUploadProgress" class="psUploadProgress hide"><div class="psUploadTrack"><div class="psUploadFill" id="psUploadProgressFill"></div></div><div class="psUploadProgressMeta"><span id="psUploadProgressLabel">Starting…</span><span id="psUploadProgressPct">0%</span></div><div class="psUploadProgressDetail" id="psUploadProgressDetail"></div></div><section class="psUploadIntro" id="psUploadIntro"><div class="psUploadDrop" id="psUploadDrop"><b>Drop in a raw Excel workbook</b><p>The reader scans the top 250 rows of every sheet and recognizes KPI pages from their actual headers, so a Retail sheet with Agent_Surname, Agent_Firstname, Team_Name, Cash Opps, Cash Apps, Insurance, Commercial, and similar fields no longer has to be named SV2. Team_Name is treated as the coach/team assignment. Retail and Referral sheets stay department-scoped.</p><button class="psUploadBtn primary" id="psUploadChooseHero" type="button">Select workbook</button></div></section><section class="psUploadResults hide" id="psUploadResults"><div class="psUploadSummary" id="psUploadSummary"></div><div class="psUploadNotice" id="psUploadNotice"></div><section class="psUploadWorkspace"><div class="psUploadWorkspaceHead"><div class="psUploadMeta" id="psUploadMeta">—</div><div class="psUploadWorkspaceTools"><details class="psUploadColumns" id="psUploadColumns"><summary class="psUploadBtn">☰ Columns</summary><div class="psUploadColumnMenu" id="psUploadColumnMenu"></div></details><button class="psUploadBtn" id="psUploadSnip" type="button">✂ Snip</button></div></div><div class="psUploadTableWrap"><table class="psUploadTable"><thead id="psUploadTableHead"></thead><tbody id="psUploadTableBody"></tbody></table></div></section></section></div></div>`;
  }
  function initializeUi() {
    if (!doc || doc.getElementById('psUploadOverlay')) return;
    const meta = doc.querySelector('meta[name="coachtools-id"]');
    if (!meta || meta.content !== 'performance-scorecard') return;
    injectStyles(); doc.body.insertAdjacentHTML('beforeend', overlayMarkup());
    const actions = doc.querySelector('.topbar .actions');
    if (actions) {
      const button = doc.createElement('button');
      button.className = 'btn icon'; button.id = 'psUploadModeBtn'; button.type = 'button'; button.textContent = '⇪ Workbook Mode';
      actions.insertBefore(button, actions.firstChild);
      button.addEventListener('click', () => { doc.getElementById('psUploadDepartment').value = currentScorecardDepartment(); doc.getElementById('psUploadOverlay').classList.remove('hide'); });
    }
    const choose = () => doc.getElementById('psUploadFile').click();
    doc.getElementById('psUploadChoose').addEventListener('click', choose);
    doc.getElementById('psUploadChooseHero').addEventListener('click', choose);
    doc.getElementById('psUploadClose').addEventListener('click', () => doc.getElementById('psUploadOverlay').classList.add('hide'));
    doc.getElementById('psUploadSnip').addEventListener('click', event => snipWorkbook(event.currentTarget).catch(error => { console.error('[Performance Scorecard Upload Mode] snip failed', error); setError(`Workbook Snip failed: ${error.message || error}`); }));
    doc.getElementById('psUploadFile').addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      parseWorkbook(file).catch(error => { console.error('[Performance Scorecard Upload Mode]', error); hideProgress(); setError(`Workbook import failed: ${error.message || error}`); }).finally(() => { event.target.value = ''; });
    });
    doc.getElementById('psUploadDepartment').addEventListener('change', () => { populateCoachOptions(); recompute(); });
    doc.getElementById('psUploadCoach').addEventListener('change', recompute);
    doc.getElementById('psUploadSearch').addEventListener('input', event => { state.search = event.target.value || ''; if (state.currentRows.length) renderResults(state.currentRows, state.diagnostics); });
    doc.getElementById('psUploadColumnMenu').addEventListener('change', event => {
      const input = event.target.closest('[data-ps-column]');
      if (!input) return;
      state.columns[input.dataset.psColumn] = Boolean(input.checked);
      saveColumnPrefs(state.columns);
      if (state.currentRows.length) renderResults(state.currentRows, state.diagnostics);
    });
    doc.getElementById('psUploadTableHead').addEventListener('click', event => {
      const th = event.target.closest('[data-ps-sort]');
      if (!th) return;
      const key = th.dataset.psSort;
      if (state.sort.key === key) state.sort.dir *= -1; else { state.sort.key = key; state.sort.dir = key === 'name' ? 1 : -1; }
      if (state.currentRows.length) renderResults(state.currentRows, state.diagnostics);
    });
    const drop = doc.getElementById('psUploadDrop');
    for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.style.borderColor = 'var(--accent)'; });
    for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.style.borderColor = ''; });
    drop.addEventListener('drop', event => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      parseWorkbook(file).catch(error => { console.error('[Performance Scorecard Upload Mode]', error); hideProgress(); setError(`Workbook import failed: ${error.message || error}`); });
    });
  }

  const api = Object.freeze({
    VERSION,
    open() { if (doc) { initializeUi(); doc.getElementById('psUploadOverlay')?.classList.remove('hide'); } },
    _test: Object.freeze({ clean, normalizeHeader, normalizeName, normalizePersonDisplay, parseNumber, parseDate, startOfSunday, dayKey, threeWeekWindow, classifySheet, classifySheetFromMatrix, inferSheetDepartment, sheetMatchesDepartment, findHeaderRow, rowsFromMatrix, nameFromRow, coachFromRow, dateFromRow, appointmentMetrics, wiperMetric, metricsFromRow, aggregateWorkbook })
  });
  root.CoachToolsPerformanceScorecardUploadMode = api;
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initializeUi, { once: true });
    else initializeUi();
  }
})(typeof window !== 'undefined' ? window : globalThis);