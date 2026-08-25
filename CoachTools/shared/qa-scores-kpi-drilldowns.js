(function installQaScoresKpiDrilldowns(root) {
  'use strict';

  const appId = document.querySelector('meta[name="coachtools-id"]')?.content || '';
  if (appId !== 'qa-scores') return;

  const SETTINGS_KEY = 'qaScores.kpiDrilldowns.v1';
  const GOAL = 0.85;
  const KPI_LABELS = Object.freeze({
    'overall qa': 'overall',
    'trend': 'trend',
    'below goal': 'below',
    'unreviewed': 'unreviewed',
    'coach / qa gap': 'gap',
    'coaching reach': 'reach'
  });

  let gapAbsolute = false;
  let trendAscending = false;
  let observer = null;

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function savePrefs(partial) {
    const next = { ...loadPrefs(), ...partial };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (_) {}
    return next;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatPct(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  }

  function formatTrend(value) {
    return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)} pp` : '—';
  }

  function getExcludeZero() {
    return Boolean(document.getElementById('excludeZero')?.checked);
  }

  function avgScore(rows) {
    const excludeZero = getExcludeZero();
    let sum = 0;
    let count = 0;
    for (const row of rows || []) {
      const score = Number(row?.score);
      if (!Number.isFinite(score)) continue;
      if (excludeZero && score === 0) continue;
      sum += score;
      count += 1;
    }
    return { avg: count ? sum / count : NaN, n: count };
  }

  function currentRows() {
    try {
      return typeof root.filterRows === 'function' ? root.filterRows() : [];
    } catch (_) {
      return [];
    }
  }

  function repHealthRows(rows) {
    try {
      if (typeof root.buildRepHealthRows === 'function') return root.buildRepHealthRows(rows || []);
    } catch (_) {}
    const grouped = new Map();
    for (const row of rows || []) {
      const key = String(row?.agentKey || row?.agent || '').trim();
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return Array.from(grouped.entries()).map(([pk, arr]) => {
      const score = avgScore(arr);
      return {
        pk,
        arr,
        name: arr[0]?.agent || pk,
        avg: score.avg,
        monitors: score.n,
        trendPP: NaN,
        coRows: [],
        outcome: { improved: false }
      };
    });
  }

  function scopeText() {
    const team = document.getElementById('teamSel');
    const timeframe = document.getElementById('tfSel');
    const dateMode = document.getElementById('dateModeSel');
    const teamText = team?.options?.[team.selectedIndex]?.textContent || 'All teams';
    const tfText = timeframe?.options?.[timeframe.selectedIndex]?.textContent || 'All';
    const dateText = dateMode?.value === 'assigned' ? 'Assigned Date' : 'Interaction Date';
    return `${teamText} • ${tfText} • ${dateText}`;
  }

  function ensureStyles() {
    if (document.getElementById('qaKpiDrilldownStyles')) return;
    const style = document.createElement('style');
    style.id = 'qaKpiDrilldownStyles';
    style.textContent = `
      #kpiGrid .kpiCard[data-qa-kpi]{cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
      #kpiGrid .kpiCard[data-qa-kpi]:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(18,24,35,.09);border-color:#c5cad2}
      #kpiGrid .kpiCard[data-qa-kpi]:focus-visible{outline:3px solid rgba(109,40,217,.24);outline-offset:2px;border-color:#8b5cf6}
      #kpiGrid .kpiCard[data-qa-kpi]::after{content:'↗';position:absolute;right:10px;top:8px;font-size:11px;font-weight:900;color:#9aa1ac;opacity:.78}
      .qaThemeToggle{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--border,#e3e6eb);border-radius:999px;background:var(--surface-2,#f7f8fa)}
      .qaThemeToggle button{border:0;background:transparent;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:850;cursor:pointer;color:var(--text-2,#5d6470)}
      .qaThemeToggle button[aria-pressed="true"]{background:#17191e;color:#fff;box-shadow:0 2px 7px rgba(18,24,35,.15)}
      #qaKpiDrilldownOverlay .panel{width:min(980px,96vw)}
      #qaKpiDrilldownOverlay .qaDrillActions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
      #qaKpiDrilldownOverlay .qaDrillTable{min-width:620px}
      #qaKpiDrilldownOverlay .qaDrillTable.compact{min-width:520px}
      #qaKpiDrilldownOverlay .qaDrillTable td,#qaKpiDrilldownOverlay .qaDrillTable th{vertical-align:middle}
      #qaKpiDrilldownOverlay .qaDrillRowRed td{background:rgba(199,44,50,.09)!important}
      #qaKpiDrilldownOverlay .qaDrillRowYellow td{background:rgba(245,158,11,.13)!important}
      #qaKpiDrilldownOverlay .qaStatusBadge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:850;border:1px solid var(--border,#e3e6eb)}
      #qaKpiDrilldownOverlay .qaStatusBadge.red{background:rgba(199,44,50,.10);color:#9f1d24;border-color:rgba(199,44,50,.24)}
      #qaKpiDrilldownOverlay .qaStatusBadge.yellow{background:rgba(245,158,11,.14);color:#8b5700;border-color:rgba(245,158,11,.28)}
      #qaKpiDrilldownOverlay .qaStatusBadge.neutral{background:#f3f4f6;color:#5d6470}

      body.qaGalactic{
        --bg:#080512;--card:#120b25;--ink:#f8f5ff;--muted:#b8aad5;--line:rgba(195,150,255,.22);--accent:#a855f7;
        --good:#37f6c4;--bad:#ff5470;--warn:#ffca5c;--shadow:0 16px 40px rgba(0,0,0,.34);
        --surface:#120b25;--surface-2:#0d091b;--surface-3:#1c1234;--text:#f8f5ff;--text-2:#b8aad5;--border:rgba(195,150,255,.22);
        --brand:#c084fc;--brand-dark:#8b5cf6;--success:#37f6c4;--warning:#ffca5c;--danger:#ff5470;
        background:
          radial-gradient(circle at 14% 9%,rgba(147,51,234,.24),transparent 28%),
          radial-gradient(circle at 82% 14%,rgba(59,130,246,.18),transparent 26%),
          radial-gradient(circle at 52% 90%,rgba(217,70,239,.12),transparent 30%),
          #080512;color:#f8f5ff;
      }
      body.qaGalactic::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:-1;opacity:.35;background-image:radial-gradient(circle,rgba(255,255,255,.8) 0 1px,transparent 1.3px);background-size:47px 47px}
      body.qaGalactic .commandHeader{background:rgba(9,5,20,.94);border-color:rgba(195,150,255,.22);box-shadow:0 8px 28px rgba(0,0,0,.26)}
      body.qaGalactic .compactBrand .eyebrow,body.qaGalactic .sectionEyebrow{color:#d8b4fe}
      body.qaGalactic .compactBrand h1,body.qaGalactic h2,body.qaGalactic .pTitle{color:#fff}
      body.qaGalactic .compactBrand .scopeLine,body.qaGalactic .sectionTitleRow p,body.qaGalactic .repSectionHead p,body.qaGalactic .pSub,body.qaGalactic .summaryHead .sub{color:#b8aad5}
      body.qaGalactic .btn,body.qaGalactic select,body.qaGalactic input,body.qaGalactic .commandControl,body.qaGalactic .commandSearch,body.qaGalactic .tabBar,body.qaGalactic .filterPopover{background:#10091f;color:#f8f5ff;border-color:rgba(195,150,255,.25)}
      body.qaGalactic .btn:hover{border-color:#c084fc;box-shadow:0 0 18px rgba(168,85,247,.18)}
      body.qaGalactic .btn.primary{background:linear-gradient(135deg,#7c3aed,#c026d3);border-color:#c084fc;color:#fff}
      body.qaGalactic .qaThemeToggle{background:#0c0718;border-color:rgba(195,150,255,.28)}
      body.qaGalactic .qaThemeToggle button{color:#cfc1e8}
      body.qaGalactic .qaThemeToggle button[aria-pressed="true"]{background:linear-gradient(135deg,#7c3aed,#c026d3);color:#fff;box-shadow:0 0 18px rgba(192,38,211,.3)}
      body.qaGalactic .viewTab{color:#cfc1e8}
      body.qaGalactic .viewTab:hover{background:#1a102f}
      body.qaGalactic .viewTab.active,body.qaGalactic .viewTab.active:hover{background:linear-gradient(135deg,#7c3aed,#a21caf);color:#fff}
      body.qaGalactic .card,body.qaGalactic .sectionShell,body.qaGalactic .secondaryDetails,body.qaGalactic .kpiCard,body.qaGalactic .repCard,body.qaGalactic .actionQueue,body.qaGalactic .weeklyFilterBar,body.qaGalactic .box,body.qaGalactic .panel,body.qaGalactic .summaryTbl,body.qaGalactic table,body.qaGalactic .weeklyTableWrap,body.qaGalactic .summaryTblWrap,body.qaGalactic .tblWrap{background:rgba(18,11,37,.96);color:#f8f5ff;border-color:rgba(195,150,255,.20);box-shadow:0 10px 30px rgba(0,0,0,.22)}
      body.qaGalactic .kpiCard{background:linear-gradient(145deg,rgba(25,14,52,.98),rgba(12,8,29,.98))}
      body.qaGalactic #kpiGrid .kpiCard[data-qa-kpi]:hover{border-color:#d8b4fe;box-shadow:0 0 0 1px rgba(216,180,254,.2),0 0 24px rgba(168,85,247,.22),0 16px 34px rgba(0,0,0,.32)}
      body.qaGalactic #kpiGrid .kpiCard[data-qa-kpi]::after{color:#e9d5ff}
      body.qaGalactic .kpiLabel{color:#bca7db}body.qaGalactic .kpiValue{color:#fff}body.qaGalactic .kpiSub{color:#a996c9}
      body.qaGalactic .kpiCard:before{background:#8b5cf6}body.qaGalactic .kpiCard.good:before,body.qaGalactic .kpiCard.midgood:before{background:#37f6c4}body.qaGalactic .kpiCard.warn:before{background:#ffca5c}body.qaGalactic .kpiCard.bad:before{background:#ff5470}
      body.qaGalactic .attentionStrip,body.qaGalactic .actionItem{background:#10091f;color:#f8f5ff;border-color:rgba(195,150,255,.16)}
      body.qaGalactic .actionItem:hover{background:#1a1030}body.qaGalactic .actionMain small,body.qaGalactic .actionScore small{color:#a996c9}
      body.qaGalactic .repCard{background:linear-gradient(145deg,rgba(21,13,43,.98),rgba(13,8,29,.98))}
      body.qaGalactic .repMeta,body.qaGalactic .legendItem,body.qaGalactic label{color:#b8aad5}
      body.qaGalactic .sparkWrap,body.qaGalactic .chartWrap{background:rgba(255,255,255,.055);border-color:rgba(195,150,255,.18)}
      body.qaGalactic canvas.spark{filter:invert(.82) hue-rotate(210deg) saturate(1.65) brightness(1.25)}
      body.qaGalactic .pill,body.qaGalactic .mini,body.qaGalactic .coachFlag,body.qaGalactic .reviewerChip{background:#170e2c;color:#efe9ff;border-color:rgba(195,150,255,.20)}
      body.qaGalactic .notice,body.qaGalactic .coItem{background:#10091f;color:#d7cbea;border-color:rgba(195,150,255,.22)}
      body.qaGalactic .pHead{background:linear-gradient(180deg,rgba(124,58,237,.20),rgba(18,11,37,0));border-color:rgba(195,150,255,.20)}
      body.qaGalactic .overlay{background:rgba(3,1,9,.72);backdrop-filter:blur(5px)}
      body.qaGalactic thead th,body.qaGalactic .summaryTbl thead th{background:#180e30!important;color:#f4edff!important;border-color:rgba(195,150,255,.18)}
      body.qaGalactic tbody td{border-color:rgba(195,150,255,.12);color:#eee8f9}
      body.qaGalactic tbody tr:hover td,body.qaGalactic .summaryTbl tbody tr:hover td{background:#1a1030!important}
      body.qaGalactic .secondaryDetails>summary{background:#10091f;color:#d8cbea;border-color:rgba(195,150,255,.18)}
      body.qaGalactic .ratingBadge,body.qaGalactic .factorPill{border-color:rgba(195,150,255,.20)}
      body.qaGalactic .trendFlat,body.qaGalactic .diffNeutral{color:#f8f5ff}
      body.qaGalactic #qaKpiDrilldownOverlay .qaDrillRowRed td{background:rgba(255,84,112,.13)!important}
      body.qaGalactic #qaKpiDrilldownOverlay .qaDrillRowYellow td{background:rgba(255,202,92,.13)!important}
      body.qaGalactic #qaKpiDrilldownOverlay .qaStatusBadge.neutral{background:#1b1133;color:#cdbfe5}
      @media(max-width:760px){.qaThemeToggle{order:3}.qaThemeToggle button{padding:6px 8px}.commandActions{flex-wrap:wrap!important}}
    `;
    document.head.appendChild(style);
  }

  function ensureThemeToggle() {
    if (document.getElementById('qaThemeToggle')) return;
    const actions = document.querySelector('.headerActions.commandActions') || document.querySelector('.commandActions');
    if (!actions) return;
    const wrap = document.createElement('div');
    wrap.id = 'qaThemeToggle';
    wrap.className = 'qaThemeToggle';
    wrap.setAttribute('aria-label', 'QA Scores color theme');
    wrap.innerHTML = `
      <button type="button" data-qa-theme="light" aria-pressed="false">Light</button>
      <button type="button" data-qa-theme="galactic" aria-pressed="false">Galactic</button>`;
    actions.insertBefore(wrap, actions.firstChild);
    wrap.addEventListener('click', event => {
      const button = event.target.closest('[data-qa-theme]');
      if (!button) return;
      applyTheme(button.dataset.qaTheme === 'galactic' ? 'galactic' : 'light', true);
    });
  }

  function applyTheme(theme, persist) {
    const mode = theme === 'galactic' ? 'galactic' : 'light';
    document.body.classList.toggle('qaGalactic', mode === 'galactic');
    document.querySelectorAll('[data-qa-theme]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.qaTheme === mode));
    });
    if (persist) savePrefs({ theme: mode });
  }

  function ensureOverlay() {
    if (document.getElementById('qaKpiDrilldownOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'qaKpiDrilldownOverlay';
    overlay.className = 'overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="panel medium" role="dialog" aria-modal="true" aria-labelledby="qaKpiDrillTitle">
        <div class="pHead">
          <div>
            <div id="qaKpiDrillTitle" class="pTitle">QA Detail</div>
            <div id="qaKpiDrillSub" class="pSub">—</div>
          </div>
          <div class="pActions">
            <div id="qaKpiDrillActions" class="qaDrillActions"></div>
            <button class="btn" id="qaKpiDrillClose" type="button">Close ✕</button>
          </div>
        </div>
        <div id="qaKpiDrillBody" class="pBody"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#qaKpiDrillClose')?.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(); });
    overlay.querySelector('#qaKpiDrillActions')?.addEventListener('click', event => {
      const trendToggle = event.target.closest('[data-qa-trend-toggle]');
      if (trendToggle) {
        trendAscending = !trendAscending;
        renderDrilldown('trend');
        return;
      }
      const gapToggle = event.target.closest('[data-qa-gap-toggle]');
      if (gapToggle) {
        gapAbsolute = !gapAbsolute;
        renderDrilldown('gap');
      }
    });
  }

  function setOverlay(title, sub, actionsHtml, bodyHtml) {
    ensureOverlay();
    const overlay = document.getElementById('qaKpiDrilldownOverlay');
    overlay.querySelector('#qaKpiDrillTitle').textContent = title;
    overlay.querySelector('#qaKpiDrillSub').textContent = sub;
    overlay.querySelector('#qaKpiDrillActions').innerHTML = actionsHtml || '';
    overlay.querySelector('#qaKpiDrillBody').innerHTML = bodyHtml || '';
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => overlay.querySelector('#qaKpiDrillClose')?.focus(), 0);
  }

  function closeOverlay() {
    const overlay = document.getElementById('qaKpiDrilldownOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function table(headers, rows, compact) {
    if (!rows.length) return '<div class="notice">No matching records in the current scope.</div>';
    return `<div class="tblWrap"><table class="qaDrillTable${compact ? ' compact' : ''}"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function renderOverall(rows, reps) {
    const sorted = [...reps].sort((a, b) => {
      const av = Number.isFinite(a.avg) ? a.avg : -Infinity;
      const bv = Number.isFinite(b.avg) ? b.avg : -Infinity;
      return bv - av || String(a.name).localeCompare(String(b.name));
    });
    const body = table(['Representative', 'Average Score', '# Monitors'], sorted.map(rep => `
      <tr><td>${escapeHtml(rep.name)}</td><td class="mono">${formatPct(rep.avg)}</td><td class="mono">${Number(rep.monitors || 0).toLocaleString()}</td></tr>`), true);
    setOverlay('Overall QA', `${scopeText()} • Representative averages`, '', body);
  }

  function renderTrend(rows, reps) {
    const sorted = [...reps].sort((a, b) => {
      const av = Number.isFinite(a.trendPP) ? a.trendPP : (trendAscending ? Infinity : -Infinity);
      const bv = Number.isFinite(b.trendPP) ? b.trendPP : (trendAscending ? Infinity : -Infinity);
      const delta = trendAscending ? av - bv : bv - av;
      return delta || String(a.name).localeCompare(String(b.name));
    });
    const action = `<button class="btn tiny active" type="button" data-qa-trend-toggle>${trendAscending ? 'Lowest → Highest' : 'Highest → Lowest'}</button>`;
    const body = table(['Representative', 'Trend', 'Average Score'], sorted.map(rep => `
      <tr><td>${escapeHtml(rep.name)}</td><td class="mono">${formatTrend(rep.trendPP)}</td><td class="mono">${formatPct(rep.avg)}</td></tr>`), true);
    setOverlay('Trend', `${scopeText()} • ${trendAscending ? 'Lowest to highest' : 'Highest to lowest'}`, action, body);
  }

  function renderBelow(rows, reps) {
    const sorted = reps
      .filter(rep => Number.isFinite(rep.avg) && rep.avg < GOAL)
      .sort((a, b) => a.avg - b.avg || String(a.name).localeCompare(String(b.name)));
    const body = table(['Representative', 'Average Score', '# Monitors'], sorted.map(rep => `
      <tr class="qaDrillRowRed"><td>${escapeHtml(rep.name)}</td><td class="mono">${formatPct(rep.avg)}</td><td class="mono">${Number(rep.monitors || 0).toLocaleString()}</td></tr>`), true);
    setOverlay('Below Goal', `${scopeText()} • Goal 85% • Lowest to highest`, '', body);
  }

  function renderUnreviewed(rows) {
    const unread = rows
      .filter(row => row?.agentHasRead === 0 || row?.unreviewed === 1)
      .sort((a, b) => {
        const byName = String(a?.agent || '').localeCompare(String(b?.agent || ''));
        if (byName) return byName;
        return String(a?.conversationId || '').localeCompare(String(b?.conversationId || ''));
      });
    const body = table(['Representative', 'Conversation ID'], unread.map(row => `
      <tr class="qaDrillRowRed"><td>${escapeHtml(row?.agent || '—')}</td><td class="mono">${escapeHtml(row?.conversationId || '—')}</td></tr>`), true);
    setOverlay('Unreviewed', `${scopeText()} • Agent Has Read = 0 • Sorted by representative name`, '', body);
  }

  function renderGap(rows) {
    const grouped = new Map();
    for (const row of rows) {
      const key = String(row?.agentKey || row?.agent || '').trim();
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    const gaps = [];
    for (const [key, arr] of grouped.entries()) {
      const coachRows = arr.filter(row => {
        try { return typeof root.isCoachEval === 'function' && root.isCoachEval(row); }
        catch (_) { return false; }
      });
      const qaRows = arr.filter(row => !coachRows.includes(row));
      const coach = avgScore(coachRows);
      const qa = avgScore(qaRows);
      if (!Number.isFinite(coach.avg) || !Number.isFinite(qa.avg)) continue;
      const gapPP = (coach.avg - qa.avg) * 100;
      gaps.push({ key, name: arr[0]?.agent || key, coach: coach.avg, qa: qa.avg, gapPP });
    }
    gaps.sort((a, b) => {
      const av = gapAbsolute ? Math.abs(a.gapPP) : a.gapPP;
      const bv = gapAbsolute ? Math.abs(b.gapPP) : b.gapPP;
      return bv - av || String(a.name).localeCompare(String(b.name));
    });
    const action = `<button class="btn tiny${gapAbsolute ? ' active' : ''}" type="button" data-qa-gap-toggle>${gapAbsolute ? 'True Difference |Δ|' : 'Signed Difference'}</button>`;
    const body = table(['Representative', 'Coach Avg', 'QA Avg', 'Difference'], gaps.map(rep => `
      <tr><td>${escapeHtml(rep.name)}</td><td class="mono">${formatPct(rep.coach)}</td><td class="mono">${formatPct(rep.qa)}</td><td class="mono">${rep.gapPP >= 0 ? '+' : ''}${rep.gapPP.toFixed(1)} pp</td></tr>`), false);
    setOverlay('Coach / QA Gap', `${scopeText()} • ${gapAbsolute ? 'Largest absolute difference first' : 'Largest signed difference first'}`, action, body);
  }

  function renderReach(rows, reps) {
    const impact = reps
      .filter(rep => Number.isFinite(rep.avg) && rep.avg < GOAL)
      .map(rep => {
        const coached = Array.isArray(rep.coRows) && rep.coRows.length > 0;
        const trendingUp = Number.isFinite(rep.trendPP) && rep.trendPP > 0;
        const status = !coached ? 'red' : (trendingUp ? 'yellow' : 'neutral');
        return { ...rep, coached, trendingUp, status };
      })
      .sort((a, b) => {
        const rank = { red: 0, yellow: 1, neutral: 2 };
        return rank[a.status] - rank[b.status] || a.avg - b.avg || String(a.name).localeCompare(String(b.name));
      });
    const body = table(['Representative', 'QA Score', 'Trend', 'Coaching Reach'], impact.map(rep => {
      const rowClass = rep.status === 'red' ? 'qaDrillRowRed' : (rep.status === 'yellow' ? 'qaDrillRowYellow' : '');
      const label = !rep.coached ? 'Not coached' : (rep.trendingUp ? 'Coached • Trending up' : 'Coached');
      return `<tr class="${rowClass}"><td>${escapeHtml(rep.name)}</td><td class="mono">${formatPct(rep.avg)}</td><td class="mono">${formatTrend(rep.trendPP)}</td><td><span class="qaStatusBadge ${rep.status}">${label}</span></td></tr>`;
    }), false);
    setOverlay('Coaching Reach', `${scopeText()} • Impact reps below 85% • Red = not coached • Yellow = coached and trending up`, '', body);
  }

  function renderDrilldown(key) {
    const rows = currentRows();
    const reps = repHealthRows(rows);
    if (key === 'overall') return renderOverall(rows, reps);
    if (key === 'trend') return renderTrend(rows, reps);
    if (key === 'below') return renderBelow(rows, reps);
    if (key === 'unreviewed') return renderUnreviewed(rows);
    if (key === 'gap') return renderGap(rows);
    if (key === 'reach') return renderReach(rows, reps);
  }

  function enhanceKpis() {
    const grid = document.getElementById('kpiGrid');
    if (!grid) return;
    grid.querySelectorAll('.kpiCard').forEach(card => {
      const label = card.querySelector('.kpiLabel')?.textContent?.trim().toLowerCase() || '';
      const key = KPI_LABELS[label];
      if (!key) return;
      card.dataset.qaKpi = key;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Open ${card.querySelector('.kpiLabel')?.textContent || 'QA'} details`);
    });
  }

  function bindKpis() {
    const grid = document.getElementById('kpiGrid');
    if (!grid || grid.dataset.qaKpiBound === '1') return;
    grid.dataset.qaKpiBound = '1';
    grid.addEventListener('click', event => {
      const card = event.target.closest('.kpiCard[data-qa-kpi]');
      if (!card) return;
      renderDrilldown(card.dataset.qaKpi);
    });
    grid.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.kpiCard[data-qa-kpi]');
      if (!card) return;
      event.preventDefault();
      renderDrilldown(card.dataset.qaKpi);
    });
    observer = new MutationObserver(enhanceKpis);
    observer.observe(grid, { childList: true, subtree: true });
    enhanceKpis();
  }

  function installKeyboardClose() {
    if (document.documentElement.dataset.qaKpiEscapeBound === '1') return;
    document.documentElement.dataset.qaKpiEscapeBound = '1';
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('qaKpiDrilldownOverlay')?.classList.contains('show')) closeOverlay();
    });
  }

  function install(attempt) {
    const grid = document.getElementById('kpiGrid');
    const actions = document.querySelector('.headerActions.commandActions') || document.querySelector('.commandActions');
    if (!grid || !actions || typeof root.filterRows !== 'function') {
      if ((attempt || 0) < 60) root.setTimeout(() => install((attempt || 0) + 1), 150);
      return;
    }
    ensureStyles();
    ensureThemeToggle();
    ensureOverlay();
    bindKpis();
    installKeyboardClose();
    const prefs = loadPrefs();
    applyTheme(prefs.theme === 'galactic' ? 'galactic' : 'light', false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(0), { once: true });
  else install(0);
})(typeof window !== 'undefined' ? window : globalThis);
