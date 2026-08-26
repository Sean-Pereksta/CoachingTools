(function installCoachToolsCalculationAlignmentPost(root) {
  'use strict';
  const C = root.CoachToolsCanonicalMetrics;
  if (!C || root.__CoachToolsCalculationAlignmentPost) return;
  root.__CoachToolsCalculationAlignmentPost = true;

  const DAY = 86400000;
  const alignedProfiles = root.__CoachToolsAlignedProfiles instanceof Map ? root.__CoachToolsAlignedProfiles : new Map();
  root.__CoachToolsAlignedProfiles = alignedProfiles;
  const clean = C.clean;
  const mean = C.mean;
  const parseDate = C.parseDate;
  const fmtPct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  const fmtDays = value => Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)}d` : '—';
  const fmtDate = value => {
    const date = value instanceof Date ? value : parseDate(value);
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—';
  };
  const normalizeName = value => root.CoachToolsIdentity && root.CoachToolsIdentity.normalizeName ? root.CoachToolsIdentity.normalizeName(value) : clean(value).toLowerCase();
  const median = values => {
    const rows = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
    if (!rows.length) return NaN;
    const index = (rows.length - 1) / 2;
    return (rows[Math.floor(index)] + rows[Math.ceil(index)]) / 2;
  };
  const daysBetween = (start, end) => start instanceof Date && end instanceof Date ? Math.max(0, (end.getTime() - start.getTime()) / DAY) : NaN;
  const daysSince = (date, asOf) => date instanceof Date ? Math.max(0, (((asOf instanceof Date && !Number.isNaN(asOf.getTime())) ? asOf.getTime() : Date.now()) - date.getTime()) / DAY) : NaN;

  function pointDate(point) {
    return parseDate(point && (point.sort || point.date || point.label));
  }

  function orderedPoints(historyIndex, personId, metricId) {
    if (!historyIndex || !historyIndex.pointsByPersonMetric) return [];
    const ids = metricId === 'consumer-appointment-rate' || metricId === 'appointment-rate'
      ? ['consumer-appointment-rate', 'cash-appointment-rate', 'appointment-rate']
      : metricId === 'cash-appointment-rate'
        ? ['cash-appointment-rate', 'consumer-appointment-rate', 'appointment-rate']
        : [metricId];
    for (const id of ids) {
      const rows = historyIndex.pointsByPersonMetric.get(`${personId}|${id}`) || [];
      if (rows.length) return rows.slice().sort((a, b) => clean(a.sort || a.label).localeCompare(clean(b.sort || b.label)));
    }
    return [];
  }

  function currentFromHistory(historyIndex, personId, metricId) {
    return C.summarizeWeighted(orderedPoints(historyIndex, personId, metricId), C.CURRENT_PERIODS);
  }

  function recentQaRows(prepared, personId) {
    const cutoff = ((prepared && prepared.asOf instanceof Date) ? prepared.asOf.getTime() : Date.now()) - C.QA_WINDOW_DAYS * DAY;
    return [...(prepared && prepared.qaByRep && prepared.qaByRep.get(personId) || [])]
      .filter(row => row.date instanceof Date && row.date.getTime() >= cutoff && Number.isFinite(row.score))
      .sort((a, b) => a.date - b.date);
  }

  function percentileFor(value, values, higherBetter) {
    const valid = (values || []).filter(Number.isFinite);
    if (!Number.isFinite(value) || valid.length < 5) return { percentile: null, score: null };
    const less = valid.filter(item => item < value).length, equal = valid.filter(item => item === value).length;
    let percentile = (less + equal * 0.5) / valid.length;
    if (higherBetter === false) percentile = 1 - percentile;
    return { percentile: Math.round(percentile * 100), score: Math.round((1 + 9 * percentile) * 10) / 10 };
  }

  function alignRepresentativeProfile(profile, prepared, historyIndex) {
    const person = profile.person, cohort = (prepared.departmentReps && prepared.departmentReps.get(person.department || '')) || [];
    const details = (profile.metricDetails || []).map(detail => ({ ...detail }));

    for (const detail of details) {
      if (detail.id === 'qa-score') continue;
      const own = currentFromHistory(historyIndex, person.personId, detail.id);
      if (!Number.isFinite(own.value)) continue;
      const peerRows = cohort.map(peer => currentFromHistory(historyIndex, peer.personId, detail.id)).filter(row => Number.isFinite(row.value));
      const peers = peerRows.map(row => row.value), relative = percentileFor(own.value, peers, detail.higherBetter);
      detail.value = own.value;
      detail.weight = own.weight || 0;
      detail.displayValue = fmtPct(own.value);
      detail.departmentAverage = mean(peers);
      detail.departmentAverageDisplay = fmtPct(detail.departmentAverage);
      if (relative.percentile != null) { detail.percentile = relative.percentile; detail.score = relative.score; }
      detail.calculationWindow = C.CURRENT_PERIODS;
    }

    const qaRows = recentQaRows(prepared, person.personId), qaAverage = mean(qaRows.map(row => row.score));
    const qaDetail = details.find(detail => detail.id === 'qa-score');
    if (qaDetail && Number.isFinite(qaAverage)) {
      const peerQa = cohort.map(peer => mean(recentQaRows(prepared, peer.personId).map(row => row.score))).filter(Number.isFinite);
      const relative = percentileFor(qaAverage, peerQa, true);
      qaDetail.value = qaAverage; qaDetail.displayValue = fmtPct(qaAverage); qaDetail.departmentAverage = mean(peerQa); qaDetail.departmentAverageDisplay = fmtPct(qaDetail.departmentAverage);
      if (relative.percentile != null) { qaDetail.percentile = relative.percentile; qaDetail.score = relative.score; }
    }

    const next = {
      ...profile,
      metricDetails: details,
      qa: { ...profile.qa, rows: qaRows.slice().sort((a, b) => b.date - a.date), evaluations: qaRows.length, average: qaAverage },
      canonicalWindowPeriods: C.CURRENT_PERIODS,
      canonicalQaWindowDays: C.QA_WINDOW_DAYS
    };
    next.issueTimeline = buildProfileEpisodes(next, prepared, historyIndex);
    return next;
  }

  function metricSamplesForProfile(profile, historyIndex, metric) {
    if (metric.id === 'qa-score') return (profile.qa && profile.qa.rows || []).map(row => ({ date: row.date, value: row.score, weight: 1 })).sort((a, b) => a.date - b.date);
    return orderedPoints(historyIndex, profile.person.personId, metric.id).map(point => ({ date: pointDate(point), value: point.value, weight: point.weight || 0 })).filter(point => point.date && Number.isFinite(point.value));
  }

  function issueStartFromSamples(samples, benchmark, higherBetter, fallback) {
    const ordered = (samples || []).filter(row => row.date instanceof Date && Number.isFinite(row.value)).sort((a, b) => a.date - b.date);
    if (!ordered.length) return fallback || null;
    if (!Number.isFinite(benchmark)) return ordered[Math.max(0, ordered.length - 3)].date;
    const isBad = value => higherBetter === false ? value > benchmark : value < benchmark;
    if (!isBad(ordered[ordered.length - 1].value)) return fallback || ordered[Math.max(0, ordered.length - 3)].date;
    let index = ordered.length - 1;
    while (index > 0 && isBad(ordered[index - 1].value)) index -= 1;
    return ordered[index].date;
  }

  function classifyOutcome(samples, coachingDate, higherBetter) {
    if (!(coachingDate instanceof Date)) return { status: 'Uncoached', before: NaN, after: NaN, delta: NaN };
    const beforeRows = samples.filter(row => row.date < coachingDate).slice(-3), afterRows = samples.filter(row => row.date > coachingDate).slice(0, 3);
    const before = mean(beforeRows.map(row => row.value)), after = mean(afterRows.map(row => row.value));
    if (!afterRows.length || !Number.isFinite(before) || !Number.isFinite(after)) return { status: 'Watching', before, after, delta: NaN };
    const oriented = (after - before) * (higherBetter === false ? -1 : 1), threshold = 0.02;
    return { status: oriented >= threshold ? 'Improved' : oriented <= -threshold ? 'Worsened' : 'No impact', before, after, delta: after - before };
  }

  function teamImpactFor(detail, profile, prepared, historyIndex) {
    if (!Number.isFinite(detail.value) || !Number.isFinite(detail.weight) || detail.weight <= 0) return NaN;
    const cohort = (prepared.departmentReps && prepared.departmentReps.get(profile.person.department || '')) || [];
    const rows = cohort.map(peer => ({ peer, stat: currentFromHistory(historyIndex, peer.personId, detail.id) })).filter(row => Number.isFinite(row.stat.value) && row.stat.weight > 0);
    const totalWeight = rows.reduce((sum, row) => sum + row.stat.weight, 0); if (!totalWeight) return NaN;
    const team = rows.reduce((sum, row) => sum + row.stat.value * row.stat.weight, 0) / totalWeight;
    const orientedGap = (team - detail.value) * (detail.higherBetter === false ? -1 : 1);
    return Math.max(0, orientedGap) * detail.weight / totalWeight;
  }

  function buildProfileEpisodes(profile, prepared, historyIndex) {
    if (!profile || profile.mode !== 'representative') return [];
    const coaching = (profile.coaching && profile.coaching.events || []).slice().sort((a, b) => a.date - b.date), episodes = [];
    for (const metric of profile.metricDetails || []) {
      const goal = C.goalForMetric(metric.id), benchmark = Number.isFinite(goal) ? goal : metric.departmentAverage;
      const adverse = Number.isFinite(goal)
        ? (metric.higherBetter === false ? metric.value > goal : metric.value < goal)
        : (Number.isFinite(metric.percentile) && metric.percentile < 45) || metric.trend && metric.trend.status === 'declining';
      if (!adverse) continue;
      const samples = metricSamplesForProfile(profile, historyIndex, metric), start = issueStartFromSamples(samples, benchmark, metric.higherBetter, samples[Math.max(0, samples.length - 3)]?.date || null);
      const matching = coaching.filter(event => (!start || event.date >= start) && (event.topics || []).some(topic => C.topicMatchesMetric(topic, metric)));
      const first = matching[0] || null, outcome = classifyOutcome(samples, first && first.date, metric.higherBetter);
      let status = outcome.status;
      if (matching.length > 1 && status !== 'Improved') status = 'Recurred';
      episodes.push({
        personId: profile.person.personId, personName: profile.person.displayName, metricId: metric.id, metric: metric.name,
        asOf: prepared && prepared.asOf instanceof Date ? new Date(prepared.asOf) : null,
        current: metric.value, benchmark, goal, teamImpact: teamImpactFor(metric, profile, prepared, historyIndex),
        problemStart: start, firstCoaching: first && first.date || null, responseDays: first && start ? daysBetween(start, first.date) : NaN,
        status, before: outcome.before, after: outcome.after, coachingCount: matching.length
      });
    }
    return episodes.sort((a, b) => (Number.isFinite(b.teamImpact) ? b.teamImpact : 0) - (Number.isFinite(a.teamImpact) ? a.teamImpact : 0) || (Number.isFinite(b.responseDays) ? b.responseDays : daysSince(b.problemStart, b.asOf)) - (Number.isFinite(a.responseDays) ? a.responseDays : daysSince(a.problemStart, a.asOf)));
  }

  function wrapProfileFast() {
    const api = root.CoachToolsProfileFast;
    if (!api || api.__canonicalPostAlignment) return;
    const nativeBuildProfile = api.buildProfile.bind(api);
    root.CoachToolsProfileFast = Object.freeze({
      ...api,
      VERSION: `${api.VERSION || '1.0'}+canonical.1`,
      __canonicalPostAlignment: true,
      buildProfile(personId, prepared, historyIndex) {
        let profile = nativeBuildProfile(personId, prepared, historyIndex);
        if (profile && profile.mode === 'representative') profile = alignRepresentativeProfile(profile, prepared, historyIndex);
        alignedProfiles.set(personId, profile);
        if (profile && profile.person) alignedProfiles.set(`name:${normalizeName(profile.person.displayName)}`, profile);
        return profile;
      }
    });
  }

  function contextMetricSamples(context, personId, metricId) {
    if (metricId === 'qa-score' || metricId === 'call-quality') {
      const cutoff = ((context && context.asOf instanceof Date) ? context.asOf.getTime() : Date.now()) - C.QA_WINDOW_DAYS * DAY;
      return (context.qa || []).filter(row => row.representativeId === personId && row.date instanceof Date && row.date.getTime() >= cutoff && Number.isFinite(row.score)).map(row => ({ date: row.date, value: row.score, weight: 1 })).sort((a, b) => a.date - b.date);
    }
    const wanted = canonicalContextIds(metricId);
    return (context.performance || []).filter(row => row.personId === personId && row.role === 'representative' && row.metric && wanted.has(C.canonicalMetricId(row.metric.id)) && row.date instanceof Date && Number.isFinite(row.value)).map(row => ({ date: row.date, value: row.value, weight: row.weight || 0 })).sort((a, b) => a.date - b.date);
  }

  function canonicalContextIds(metricId) {
    return new Set([C.canonicalMetricId(metricId)]);
  }

  function contextCurrent(samples) {
    const points = samples.map(row => ({ value: row.value, weight: row.weight, sort: row.date.toISOString() }));
    return C.summarizeWeighted(points, C.CURRENT_PERIODS);
  }

  function metricObjectForContext(context, metricId) {
    const canonical = C.canonicalMetricId(metricId);
    if (canonical === 'cash-appointment-rate') return (root.CoachToolsIntelligence.METRICS || []).find(metric => metric.id === 'consumer-appointment-rate' || metric.id === 'appointment-rate') || { id: metricId, name: 'Cash Appointment Rate', higher: true };
    if (canonical === 'qa-score') return { id: 'qa-score', name: 'QA Score', higher: true };
    return (root.CoachToolsIntelligence.METRICS || []).find(metric => C.canonicalMetricId(metric.id) === canonical) || { id: metricId, name: metricId, higher: true };
  }

  function buildCommandEpisodes(summary) {
    if (!summary || !summary.context) return [];
    const context = summary.context, source = [...(summary.priorityDrivers || []), ...(summary.allOpportunities || summary.opportunities || [])], seen = new Set(), episodes = [];
    for (const item of source) {
      if (!item || !item.personId || item.metricId === 'checklist-support') continue;
      const key = `${item.personId}|${C.canonicalMetricId(item.metricId)}`; if (seen.has(key)) continue; seen.add(key);
      const metric = metricObjectForContext(context, item.metricId), samples = contextMetricSamples(context, item.personId, item.metricId); if (!samples.length) continue;
      const current = contextCurrent(samples), goal = C.goalForMetric(item.metricId), teamBenchmark = item.evidence && item.evidence.teamValue;
      const benchmark = Number.isFinite(goal) ? goal : Number.isFinite(teamBenchmark) ? teamBenchmark : NaN;
      const start = issueStartFromSamples(samples, benchmark, metric.higher !== false, item.openedAt instanceof Date ? item.openedAt : null);
      const matching = (context.coaching || []).filter(event => event.representativeId === item.personId && event.date instanceof Date && (!start || event.date >= start) && (event.topics || []).some(topic => C.topicMatchesMetric(topic, metric))).sort((a, b) => a.date - b.date);
      const first = matching[0] || null, outcome = classifyOutcome(samples, first && first.date, metric.higher !== false);
      let status = outcome.status; if (matching.length > 1 && status !== 'Improved') status = 'Recurred';
      episodes.push({
        personId: item.personId, personName: item.personName || (context.byId.get(item.personId) || {}).displayName || '', metricId: item.metricId, metric: item.metric || item.topic || metric.name,
        asOf: context.asOf instanceof Date ? new Date(context.asOf) : null,
        current: current.value, benchmark, goal, teamImpact: Number.isFinite(item.evidence && item.evidence.teamImpact) ? item.evidence.teamImpact : Number.isFinite(item.impactScore) ? item.impactScore : NaN,
        problemStart: start, firstCoaching: first && first.date || null, responseDays: first && start ? daysBetween(start, first.date) : NaN,
        status, before: outcome.before, after: outcome.after, coachingCount: matching.length, severity: item.severity || 0
      });
    }
    return episodes.sort((a, b) => (Number.isFinite(b.teamImpact) ? b.teamImpact : 0) - (Number.isFinite(a.teamImpact) ? a.teamImpact : 0) || b.severity - a.severity).slice(0, 14);
  }

  function outcomeClass(status) {
    if (status === 'Improved') return 'good';
    if (status === 'Uncoached' || status === 'Worsened' || status === 'Recurred') return 'bad';
    return 'warn';
  }

  function timelineSummary(episodes) {
    const coached = episodes.filter(row => row.firstCoaching), response = episodes.map(row => row.responseDays).filter(Number.isFinite);
    return {
      total: episodes.length, reach: episodes.length ? coached.length / episodes.length : NaN, medianResponse: median(response),
      within3: response.length ? response.filter(value => value <= 3).length / response.length : NaN,
      improved: episodes.filter(row => row.status === 'Improved').length,
      oldestOpen: Math.max(0, ...episodes.filter(row => !row.firstCoaching).map(row => daysSince(row.problemStart, row.asOf)).filter(Number.isFinite))
    };
  }

  function timelineTable(episodes, includePerson) {
    if (!episodes.length) return '<div class="ctAlignEmpty">No active KPI/QA issue episodes in this view.</div>';
    return `<div class="ctAlignTableWrap"><table class="ctAlignTable"><thead><tr>${includePerson ? '<th>Representative</th>' : ''}<th>Problem</th><th>Current</th><th>Goal / benchmark</th><th>Team impact</th><th>Problem start</th><th>First relevant coaching</th><th>Response</th><th>Outcome</th></tr></thead><tbody>${episodes.map(row => `<tr>${includePerson ? `<td><b>${escapeHtml(row.personName)}</b></td>` : ''}<td><b>${escapeHtml(row.metric)}</b></td><td>${formatCurrent(row)}</td><td>${formatBenchmark(row)}</td><td>${formatImpact(row)}</td><td>${fmtDate(row.problemStart)}</td><td>${fmtDate(row.firstCoaching)}</td><td>${row.firstCoaching ? fmtDays(row.responseDays) : `<span class="ctAlignOpen">${fmtDays(daysSince(row.problemStart, row.asOf))} open</span>`}</td><td><span class="ctAlignStatus ${outcomeClass(row.status)}">${escapeHtml(row.status)}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function formatCurrent(row) { return Number.isFinite(row.current) ? (Math.abs(row.current) <= 1.5 ? fmtPct(row.current) : row.current.toFixed(1)) : '—'; }
  function formatBenchmark(row) { return Number.isFinite(row.benchmark) ? (Math.abs(row.benchmark) <= 1.5 ? fmtPct(row.benchmark) : row.benchmark.toFixed(1)) : '—'; }
  function formatImpact(row) { return Number.isFinite(row.teamImpact) ? `${(row.teamImpact * 100).toFixed(2)}pp` : '—'; }

  function ensureStyles() {
    if (!root.document || root.document.getElementById('coachtools-canonical-alignment-style')) return;
    const style = root.document.createElement('style'); style.id = 'coachtools-canonical-alignment-style';
    style.textContent = `
      .ctAlignContract{font-size:9px;color:var(--muted);font-weight:800}.ctAlignMetrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-bottom:9px}.ctAlignMetric{border:1px solid var(--line);border-radius:11px;background:#fbfdfe;padding:9px}.ctAlignMetric small{display:block;color:var(--muted);font-size:8px;text-transform:uppercase;font-weight:900;letter-spacing:.04em}.ctAlignMetric b{display:block;margin-top:3px;font-size:16px}.ctAlignTableWrap{overflow:auto}.ctAlignTable{width:100%;border-collapse:collapse;min-width:940px;font-size:9px}.ctAlignTable th{padding:7px 8px;background:#f7fafc;color:var(--muted);text-align:left;text-transform:uppercase;font-size:8px;letter-spacing:.04em;border-bottom:1px solid var(--line)}.ctAlignTable td{padding:8px;border-bottom:1px solid #edf1f4;vertical-align:middle}.ctAlignStatus{display:inline-flex;padding:4px 6px;border-radius:999px;font-size:8px;font-weight:900}.ctAlignStatus.good{background:#e8f7ef;color:#147050}.ctAlignStatus.warn{background:#fff1dd;color:#8b5900}.ctAlignStatus.bad{background:#fdeceb;color:#a13230}.ctAlignOpen{color:#a13230;font-weight:900}.ctAlignEmpty{padding:16px;text-align:center;color:var(--muted);font-size:10px}.ctAlignPeopleCard{grid-column:1/-1}.ctAlignPeopleCard .ctAlignMetrics{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:850px){.ctAlignMetrics,.ctAlignPeopleCard .ctAlignMetrics{grid-template-columns:1fr 1fr}}
    `;
    root.document.head.appendChild(style);
  }

  function summaryMetricsMarkup(summary) {
    return `<div class="ctAlignMetrics"><div class="ctAlignMetric"><small>Impact issues</small><b>${summary.total}</b></div><div class="ctAlignMetric"><small>Coaching reach</small><b>${Number.isFinite(summary.reach) ? Math.round(summary.reach * 100) + '%' : '—'}</b></div><div class="ctAlignMetric"><small>Median time to coach</small><b>${fmtDays(summary.medianResponse)}</b></div><div class="ctAlignMetric"><small>Within 3 days</small><b>${Number.isFinite(summary.within3) ? Math.round(summary.within3 * 100) + '%' : '—'}</b></div><div class="ctAlignMetric"><small>Improved</small><b>${summary.improved}</b></div></div>`;
  }

  function paintCommandCenter() {
    const appId = clean(root.document && root.document.querySelector('meta[name="coachtools-id"]')?.content);
    if (appId !== 'coaching-command-center') return;
    const content = root.document.getElementById('content'), summary = root.__CoachToolsCommandCenterSummary; if (!content || !summary) return;
    const episodes = buildCommandEpisodes(summary), metrics = timelineSummary(episodes);
    let panel = content.querySelector('[data-canonical-issue-timeline]');
    if (!panel) {
      panel = root.document.createElement('section'); panel.className = 'panel'; panel.dataset.canonicalIssueTimeline = '1';
      const anchor = content.querySelector('.grid2') || content.querySelector('.panel');
      if (anchor) anchor.insertAdjacentElement('beforebegin', panel); else content.appendChild(panel);
    }
    panel.innerHTML = `<div class="panelHead"><div><h2>Issue → coaching → outcome</h2><p>Canonical 4-period weighted KPIs · QA 30d · first relevant coaching after the issue begins.</p></div><span class="meta">Same calculation contract as People Profiles</span></div><div class="panelBody">${summaryMetricsMarkup(metrics)}${timelineTable(episodes, true)}</div>`;
  }

  function currentVisibleProfile() {
    const title = root.document && root.document.querySelector('.profileIdentity h1');
    return title ? alignedProfiles.get(`name:${normalizeName(title.textContent)}`) : null;
  }

  function paintPeopleProfiles() {
    const appId = clean(root.document && root.document.querySelector('meta[name="coachtools-id"]')?.content);
    if (appId !== 'people-profiles') return;
    const profile = currentVisibleProfile(), panel = root.document.querySelector('.tabPanel'); if (!profile || !panel) return;
    const sectionTitle = clean(panel.querySelector('.sectionTitle h2')?.textContent);
    if (!/dashboard/i.test(sectionTitle)) return;
    let episodes = [];
    if (profile.mode === 'representative') episodes = profile.issueTimeline || [];
    else {
      const ids = new Set((profile.relationships && profile.relationships.representatives || []).map(rep => rep.personId));
      for (const [key, repProfile] of alignedProfiles) if (!String(key).startsWith('name:') && ids.has(key) && repProfile && repProfile.issueTimeline) episodes.push(...repProfile.issueTimeline);
      episodes.sort((a, b) => (Number.isFinite(b.teamImpact) ? b.teamImpact : 0) - (Number.isFinite(a.teamImpact) ? a.teamImpact : 0));
      episodes = episodes.slice(0, 12);
    }
    const grid = panel.querySelector('.grid'); if (!grid) return;
    let card = grid.querySelector('[data-canonical-people-timeline]');
    if (!card) { card = root.document.createElement('div'); card.className = 'card full ctAlignPeopleCard'; card.dataset.canonicalPeopleTimeline = '1'; const firstFull = grid.querySelector('.card.full'); if (firstFull) firstFull.insertAdjacentElement('afterend', card); else grid.prepend(card); }
    const summary = timelineSummary(episodes);
    card.innerHTML = `<div class="cardHead"><h3>${profile.mode === 'coach' ? 'Team issue → coaching → outcome' : 'Issue → coaching → outcome'}</h3><span class="pill">Canonical KPI 4w · QA 30d</span></div>${summaryMetricsMarkup(summary)}${timelineTable(episodes, profile.mode === 'coach')}<div class="ctAlignContract" style="margin-top:8px">Cash AR = Σ Consumer Appointments ÷ Σ Consumer Opportunities · Referral AR stays separate · Retail Wipers = Count ÷ Jobs · Referral Wipers = Accepted ÷ Asked.</div>`;
    for (const node of panel.querySelectorAll('.pulse .sub')) if (/Weekly current/i.test(node.textContent)) node.textContent = node.textContent.replace(/Weekly current/i, 'Canonical 4-week');
    for (const cardNode of panel.querySelectorAll('.card')) if (clean(cardNode.querySelector('h3')?.textContent) === 'QA average') { const sub = cardNode.querySelector('.sub'); if (sub && !/30d/i.test(sub.textContent)) sub.textContent += ' · 30d'; }
  }

  function installEnhancers() {
    if (!root.document) return;
    ensureStyles();
    let scheduled = false;
    const paint = () => {
      if (scheduled) return; scheduled = true;
      root.requestAnimationFrame(() => { scheduled = false; try { paintCommandCenter(); paintPeopleProfiles(); } catch (error) { console.warn('[CoachTools canonical alignment] timeline paint skipped', error); } });
    };
    const start = () => { paint(); const content = root.document.getElementById('content'); if (content) new MutationObserver(paint).observe(content, { childList: true, subtree: true }); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }

  wrapProfileFast();
  installEnhancers();
})(typeof window !== 'undefined' ? window : globalThis);
