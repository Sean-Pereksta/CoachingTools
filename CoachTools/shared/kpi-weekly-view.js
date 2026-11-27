(function () {
  'use strict';

  const core = window.KpiWeeklyCore;
  const host = document.getElementById('kpiWeekly');
  if (!core || !host) return;
  const ui = id => document.getElementById(id);
  const date = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
  const year = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  const noteDate = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'});
  const number = new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
  let context, weeks, byWeek, report, topic, focusedRep;
  let tab = 'weekly';
  const dialog = ui('weeklyDashboard');
  const selector = ui('weeklyDate');

  function text(tag, value, className) {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function button(label, onClick, className = 'btn') {
    const control = text('button',label,className);
    control.type = 'button';
    control.addEventListener('click',onClick);
    return control;
  }
  function range(start) {
    const end = start + 6 * core.day;
    const first = new Date(start).getUTCFullYear() === new Date(end).getUTCFullYear() ? date : year;
    return first.format(start) + ' – ' + year.format(end);
  }
  const pct = rate => Number.isFinite(rate) ? (rate * 100).toFixed(1) + '%' : '—';
  const pp = rate => Number.isFinite(rate) ? (rate > .00005 ? '+' : rate < -.00005 ? '−' : '') + (Math.abs(rate) * 100).toFixed(1) + ' pp' : '—';
  const tone = value => value > .00005 ? 'up' : value < -.00005 ? 'down' : 'flat';
  function gapLabel(gap, unit) {
    if (!gap || !unit) return '—';
    const count = Math.abs(gap.count);
    const word = count === 1 ? unit.slice(0,-1) : unit;
    return count ? `${number.format(count)} ${word} ${gap.count < 0 ? 'short' : 'above'}` : 'Met';
  }
  function badge(value, status) { return text('span',value,'weeklyBadge ' + status); }
  function stat(label, value, sub, status='flat') {
    const card = text('div',undefined,'weeklyStat');
    card.append(text('span',label,'weeklyEyebrow'),text('strong',value,status),text('small',sub));
    return card;
  }
  function muted(value) { return text('p',value,'weeklyMuted'); }
  function empty(message) { return text('p',message,'weeklyEmpty'); }
  const getStart = () => Number(selector.value);
  const getReport = start => core.compare(byWeek,start,context.window,context.goal);

  function compact() {
    report = weeks.includes(getStart()) ? getReport(getStart()) : null;
    const current = report ? range(getStart()) : 'No measured weeks';
    ui('weeklyCompareDate').textContent = report ? range(getStart()-core.week) : '—';
    const rate = ui('weeklyTeamMove');
    rate.textContent = report ? `${pct(report.before)} → ${pct(report.after)}` : '—';
    const movement = ui('weeklyTrend');
    movement.textContent = Number.isFinite(report?.delta) ? pp(report.delta) : 'No prior data';
    movement.className = 'weeklyBadge ' + tone(report?.delta);
    for (const [id,gap] of [['weeklyGoalGap',report?.goalGap],['weeklyPriorGap',report?.priorGap]]) {
      const displayed = ui(id);
      displayed.textContent = gapLabel(gap,context.unit);
      displayed.className = tone(Math.sign(gap?.count));
    }
    ui('weeklyContext').textContent = `${context.metricLabel} · Included team`;
    ui('weeklyExpand').disabled = !report;
    selector.disabled = !report;
    if (!report && dialog.open) dialog.close();
    if (dialog.open) paintDialog();
    host.dataset.week = report ? current : '';
  }

  function render(next) {
    context = next;
    const previous = selector.value;
    const currentWeek = core.weekStart(new Date());
    byWeek = core.index(context.activeRows,currentWeek);
    weeks = core.recent(byWeek,context.window);
    selector.replaceChildren();
    for (const start of weeks) {
      const delta = core.rate(byWeek.get(start).total) - core.rate(byWeek.get(start-core.week)?.total);
      const trend = Number.isFinite(delta) ? `${tone(delta)==='up' ? '↑' : tone(delta)==='down' ? '↓' : '→'} ${pp(delta)}` : 'No prior data';
      const option = text('option',`${range(start)}   |   ${trend}`);
      option.value = String(start);
      selector.append(option);
    }
    if (!weeks.length) selector.append(text('option','No complete weeks with KPI data'));
    if (weeks.includes(Number(previous)) && previous) selector.value = previous;
    compact();
  }

  function highlightList(title, rows, field, message) {
    const panel = text('section',undefined,'weeklyPanel');
    panel.append(text('h3',title),muted(message));
    if (!rows.length) panel.append(empty('No matching representatives.'));
    for (const row of rows.slice(0,4)) {
      const line = text('div',undefined,'weeklyListRow');
      line.append(button(row.name,() => {
        focusedRep = row.key;
        paintDialog();
        ui('weeklyRepFocus')?.focus();
      },'weeklyLink'),badge(pp(row[field]),tone(row[field])),text('span',row.classification,'weeklyClassification'));
      panel.append(line);
    }
    return panel;
  }

  function table(headings) {
    const wrapper = text('div',undefined,'weeklyTableWrap');
    const grid = text('table');
    const heading = text('tr');
    headings.forEach(label => {
      const th = text('th',label); th.scope = 'col'; heading.append(th);
    });
    const head = text('thead'); head.append(heading);
    const body = text('tbody');
    grid.append(head,body); wrapper.append(grid);
    return {wrapper,body};
  }

  function addRow(body, values) {
    const row = text('tr');
    values.forEach((value,index) => {
      const cell = text(index === 0 ? 'th' : 'td');
      if (index === 0) cell.scope = 'row';
      if (typeof value === 'string') cell.textContent = value;
      else cell.append(value);
      row.append(cell);
    });
    body.append(row);
    return row;
  }

  function paintWeekly(body) {
    const start = getStart();
    const activeTopic = core.topics[context.activeTopic];
    const counts = activeTopic ? core.coachingCounts(context.events,context.activeTopic,start) : null;
    const volume = context.activeTopic === 'callQuality' ? 'evaluations' : context.activeTopic === 'wiper' ? 'offers' : 'opportunities';
    const repVolume = `${report.priorReps ?? '—'} → ${report.currentReps} reps`;
    const hasComparison = Number.isFinite(report.delta);
    const stats = text('div',undefined,'weeklyStatGrid');
    stats.append(
      stat('Team rate',`${pct(report.before)} → ${pct(report.after)}`,hasComparison ? pp(report.delta) + ' from prior week' : 'No prior week measurement',tone(report.delta)),
      stat('At this volume',gapLabel(report.goalGap,context.unit),`Goal ${pct(context.goal)} · prior result ${gapLabel(report.priorGap,context.unit)}`,tone(Math.sign(report.goalGap?.count))),
      stat('Measured volume',`${report.prior ? number.format(report.prior.volume) : '—'} → ${number.format(report.current.volume)}`,`${volume} · ${repVolume}`),
      stat(activeTopic ? `${activeTopic.coachingLabel} coachings` : 'Topic coachings',counts && context.coachingLoaded ? `${counts.previous} → ${counts.current}` : '—',counts ? 'Prior → selected week · selected coaching types' : 'Choose Cash, Call Quality, or Wipers in Coaching impact')
    );
    body.append(stats);
    if (hasComparison) body.append(muted(`Team movement: ${pp(report.performance)} from rate changes and ${pp(report.mix)} from opportunity mix.`));
    const highlights = text('div',undefined,'weeklyHighlights');
    const falling = report.delta < 0;
    const driverMessage = !hasComparison ? 'No prior week data for an impact comparison.'
      : tone(report.delta)==='flat' ? 'No material team rate change in this comparison.' : 'Share of the team’s change, including volume.';
    highlights.append(
      highlightList(falling ? 'Biggest downward drivers' : 'Biggest upward drivers',hasComparison && tone(report.delta)!=='flat' ? report.drivers : [],'contribution',driverMessage),
      highlightList(falling ? 'Furthest below their norm' : 'Furthest above their norm',report.deviations,'vsNorm','Change from each rep’s volume-weighted baseline.')
    );
    body.append(highlights);
    const heading = text('h3','Representative detail');
    heading.id = 'weeklyRepFocus'; heading.tabIndex = -1;
    body.append(heading);
    const grid = table(['Representative','Prior week','Selected week','Team impact','Normal rate','Performance','To goal','Vs prior result']);
    for (const row of report.rows) {
      const selected = addRow(grid.body,[row.name,pct(row.beforeRate),pct(row.afterRate),pp(row.contribution),
        row.normWeeks ? `${pct(row.norm)} · ${row.normWeeks} wk` : '—',row.classification,
        badge(gapLabel(row.goalGap,context.unit),tone(Math.sign(row.goalGap?.count))),
        badge(gapLabel(row.priorGap,context.unit),tone(Math.sign(row.priorGap?.count)))]);
      if (row.key === focusedRep) selected.className = 'weeklyFocusedRep';
    }
    body.append(grid.wrapper,muted(`Normal rate uses up to ${context.window} previous calendar weeks with measured volume. A swing of 10 percentage points or more is overperformance or underperformance. Count gaps use the selected week’s volume.`));
  }

  function noteSamples(samples) {
    const details = text('details',undefined,'weeklyNoteList');
    details.append(text('summary','View coachings'));
    for (const sample of samples) {
      const section = text('section');
      section.append(text('strong',`${range(sample.start)} · ${sample.status || `${pct(core.rate(sample.before))} → ${pct(core.rate(sample.after))}`}`));
      if (!sample.status) section.append(muted(`${number.format(sample.before.volume)} before · ${number.format(sample.after.volume)} after`));
      for (const record of sample.events) {
        section.append(text('h4',`${noteDate.format(record.date)} · ${record.type || 'Documented Coaching'}`),text('p',record.desc || 'No description recorded.'));
      }
      details.append(section);
    }
    return details;
  }

  function paintCoaching(body) {
    const filters = text('div',undefined,'weeklyCoachingControls');
    const choices = text('div',undefined,'weeklyTopicChoices');
    for (const [key,item] of Object.entries(core.topics)) {
      const choice = button(item.label,() => {topic=key; paintDialog(); ui('weeklyTopic-'+key)?.focus();});
      choice.id = 'weeklyTopic-'+key;
      choice.setAttribute('aria-pressed',String(key===topic));
      choices.append(choice);
    }
    const typeMenu = text('details',undefined,'weeklyTypeChoices');
    typeMenu.append(text('summary',context.typesLabel));
    if (context.types.length) {
      const all = button('Select all',() => context.setTypes(null)); all.id = 'weeklyTypesAll';
      const none = button('Unselect all',() => context.setTypes([])); none.id = 'weeklyTypesNone';
      typeMenu.append(all,none);
      for (const [index,type] of context.types.entries()) {
        const label = text('label');
        const option = text('input'); option.type='checkbox'; option.checked=type.checked;
        option.id = 'weeklyType-'+index;
        option.addEventListener('change',() => context.toggleType(type.name,option.checked));
        label.append(option,document.createTextNode(type.name)); typeMenu.append(label);
      }
    } else typeMenu.append(muted('No documented coaching types available.'));
    typeMenu.open = !!ui('weeklyDashboardBody').dataset.typesOpen;
    typeMenu.addEventListener('toggle',()=>{if(typeMenu.isConnected)ui('weeklyDashboardBody').dataset.typesOpen=typeMenu.open?'yes':'';});
    filters.append(choices,typeMenu);
    body.append(filters,muted(`${core.topics[topic].coachingLabel} coaching · ${context.window}-week review ending ${range(getStart())}. ${context.allTypes ? 'All Coaching Types are selected. Narrow the checklist above to review specific types.' : ''}`));
    if (!context.coachingLoaded) { body.append(empty('Load Documented Coaching to see coaching outcomes.')); return; }
    if (!context.types.some(type=>type.checked)) { body.append(empty('Select a Coaching Type to see outcomes.')); return; }
    const metric = core.index(context.rowsForTopic(topic),core.weekStart(new Date()));
    if (!metric.size) body.append(empty(topic === 'callQuality' ? 'No measured Call Quality evaluations for this team. Load All Evaluations in MyOne.' : 'No measured KPI data for this topic and team.'));
    const outcome = core.coachingOutcome(metric,context.events,topic,getStart(),context.window);
    const stats = text('div',undefined,'weeklyStatGrid coaching');
    stats.append(stat('Average change after coaching',pp(outcome.delta),`${outcome.coachingCount} measured coaching ${outcome.coachingCount===1 ? 'record' : 'records'} · ${outcome.cases.length} rep-${outcome.cases.length===1 ? 'week' : 'weeks'}`,tone(outcome.delta)),
      stat('Three weeks before',pct(outcome.before),'Weighted by measured volume'),stat('Three weeks after',pct(outcome.after),'Coaching week excluded'));
    body.append(stats,muted(`${outcome.pending} awaiting follow-up · ${outcome.insufficient} missing a measurable before or after window`));
    if (outcome.reps.length) {
      const grid = table(['Representative','Coaching records','Before','After','Average change','Documented coaching']);
      for (const rep of outcome.reps) {
        const total = rep.records.reduce((count,sample)=>count+sample.events.length,0);
        addRow(grid.body,[rep.name,`${rep.coachingCount} of ${total} measured`,pct(rep.before),pct(rep.after),badge(pp(rep.delta),tone(rep.delta)),noteSamples(rep.records)]);
      }
      body.append(grid.wrapper);
    } else body.append(empty('No measurable coaching comparisons in this review.'));
    body.append(muted('Uses three calendar weeks on each side and skips weeks with no measurable volume. Same-topic coachings in one rep-week share one comparison. Each comparison is weighted by its smaller before/after volume. Other events can affect the measured change.'));
  }

  function paintDialog() {
    const body = ui('weeklyDashboardBody');
    const focusId = document.activeElement?.id;
    ui('weeklyDashboardDates').textContent = range(getStart()) + ' vs ' + range(getStart()-core.week);
    for (const [id,key] of [['weeklyTabWeekly','weekly'],['weeklyTabCoaching','coaching']]) ui(id).setAttribute('aria-pressed',String(tab===key));
    body.replaceChildren();
    if (tab === 'weekly') paintWeekly(body);
    else paintCoaching(body);
    if (focusId && !document.activeElement?.id) ui(focusId)?.focus();
  }
  function changeTab(next) { tab=next; paintDialog(); }
  selector.addEventListener('change', () => { focusedRep=null; compact(); });
  ui('weeklyExpand').addEventListener('click', () => {
    topic=context.activeTopic || 'consumer';
    changeTab('weekly');
    dialog.showModal();
  });
  ui('weeklyTabWeekly').addEventListener('click',() => changeTab('weekly'));
  ui('weeklyTabCoaching').addEventListener('click',() => changeTab('coaching'));
  window.KpiWeeklyView = Object.freeze({render});
})();
