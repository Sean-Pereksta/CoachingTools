(function installCoachingGapsTimelineEnhancements(root) {
  'use strict';

  if ((document.querySelector('meta[name="coachtools-id"]')?.content || '') !== 'coaching-gaps') return;

  const required = ['canonicalizeQA', 'loadQA', 'render', 'qaMonitorRowsForRepWeek', 'qaConversationId'];
  let installed = false;
  let tooltipHover = false;
  let decorateQueued = false;

  const clean = value => String(value == null ? '' : value).trim();
  const normKey = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const esc = value => clean(value).replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));

  function pick(row, names) {
    const map = new Map(Object.keys(row || {}).map(key => [normKey(key), key]));
    for (const name of names || []) {
      const real = map.get(normKey(name));
      if (real !== undefined) return row[real];
    }
    return undefined;
  }

  function parseReadFlag(value) {
    if (value === 1 || value === true) return 1;
    if (value === 0 || value === false) return 0;
    const text = clean(value).toLowerCase();
    if (['1','yes','y','true','read','reviewed','complete','completed'].includes(text)) return 1;
    if (['0','no','n','false','unread','not read','unreviewed','not reviewed'].includes(text)) return 0;
    const numeric = Number(text);
    if (Number.isFinite(numeric)) return numeric === 1 ? 1 : (numeric === 0 ? 0 : null);
    return null;
  }

  function formatInteractionDuration(value) {
    const text = clean(value);
    if (!text) return '—';

    const clockMatch = /^(\d+):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?$/.exec(text);
    if (clockMatch) {
      const first = Number(clockMatch[1]);
      const second = Number(clockMatch[2]);
      const third = clockMatch[3] == null ? null : Number(clockMatch[3]);
      if ([first, second].every(Number.isFinite) && (third == null || Number.isFinite(third))) {
        const totalSeconds = third == null
          ? Math.round((first * 60) + second)
          : Math.round((first * 3600) + (second * 60) + third);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
      }
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1) {
      const totalSeconds = Math.round(numeric * 86400);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    return text;
  }

  function sundayForIsoWeekKey(weekKey) {
    const match = /^(\d{4})-W(\d{1,2})$/i.exec(clean(weekKey));
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) return null;

    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4IsoDay = jan4.getUTCDay() || 7;
    const weekOneMonday = new Date(Date.UTC(year, 0, 4 - jan4IsoDay + 1));
    const monday = new Date(weekOneMonday.getTime() + ((week - 1) * 7 * 86400000));
    return new Date(monday.getTime() - 86400000);
  }

  function shortDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return '—';
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  }

  function weekSundayLabel(weekKey) {
    return shortDate(sundayForIsoWeekKey(weekKey));
  }

  function patchTooltipWeekHeader() {
    const original = root.buildTooltipText;
    if (typeof original !== 'function' || original.__cgShortDateHover) return;

    function enhancedBuildTooltipText(rep, wk) {
      const text = original.apply(this, arguments);
      const weekKey = clean(wk);
      const dateLabel = weekSundayLabel(weekKey);
      if (!weekKey || !dateLabel || dateLabel === '—') return text;

      const lines = String(text == null ? '' : text).split('\n');
      if (!lines.length) return text;
      lines[0] = lines[0].replace(weekKey, dateLabel);
      return lines.join('\n');
    }

    enhancedBuildTooltipText.__cgShortDateHover = true;
    enhancedBuildTooltipText.__original = original;
    root.buildTooltipText = enhancedBuildTooltipText;
  }

  function patchCanonicalQA() {
    const original = root.canonicalizeQA;
    if (typeof original !== 'function' || original.__cgTimelineEnhancement) return;

    function enhancedCanonicalizeQA(dockObj) {
      const rows = original.apply(this, arguments);
      return (Array.isArray(rows) ? rows : []).map(row => {
        const agentReadRaw = pick(row, ['Agent has Read.', 'Agent has Read', 'agenthasread', 'read', 'readflag', 'readstatus']);
        const durationRaw = pick(row, ['Interaction Duration', 'interactionduration', 'duration', 'callduration', 'conversationduration']);
        const queueRaw = pick(row, ['Queue Name', 'queuename', 'queue_name', 'queue', 'interactionqueue']);
        const evaluatorRaw = row.evaluator || pick(row, ['Evaluator Name', 'evaluatorname', 'evaluator', 'monitor', 'reviewer', 'qaevaluator']);
        const explicitRead = parseReadFlag(agentReadRaw);

        return {
          ...row,
          readFlag: explicitRead === null ? parseReadFlag(row.readFlag) : explicitRead,
          interactionDuration: clean(durationRaw),
          queueName: clean(queueRaw),
          evaluator: clean(evaluatorRaw)
        };
      });
    }

    enhancedCanonicalizeQA.__cgTimelineEnhancement = true;
    enhancedCanonicalizeQA.__original = original;
    root.canonicalizeQA = enhancedCanonicalizeQA;
  }

  function addStyles() {
    if (document.getElementById('cg-timeline-enhancement-style')) return;
    const style = document.createElement('style');
    style.id = 'cg-timeline-enhancement-style';
    style.textContent = `
      .tt{
        pointer-events:auto !important;
        overflow-y:auto !important;
        overscroll-behavior:contain;
        scrollbar-gutter:stable;
      }
      .weekOrb.monitor{
        background:#111827 !important;
      }
      .weekOrb.monitor.cgMonitorUnread{
        border-color:#dc2626 !important;
        box-shadow:0 0 0 1px rgba(220,38,38,.28),0 3px 8px rgba(15,23,42,.22) !important;
      }
      .weekOrb.monitor.cgMonitorReviewed{
        border-color:#16a34a !important;
        box-shadow:0 0 0 1px rgba(22,163,74,.28),0 3px 8px rgba(15,23,42,.22) !important;
      }
    `;
    document.head.appendChild(style);
  }

  function patchTooltipBehavior() {
    const tt = document.getElementById('tt');
    if (!tt || tt.dataset.cgScrollable === '1') return;
    tt.dataset.cgScrollable = '1';

    // Prevent the app's document-level pointerout handler from closing the tooltip
    // during the handoff from the blue KPI/coaching segment into the popup.
    document.addEventListener('pointerout', event => {
      const from = event.target && event.target.closest ? event.target.closest('.seg, .cbseg') : null;
      if (!from) return;
      const to = event.relatedTarget;
      if (to && tt.contains(to)) {
        tooltipHover = true;
        event.stopImmediatePropagation();
      }
    }, true);

    // The stock tooltip follows the pointer. Freeze it while the user is inside it,
    // otherwise the popup would move underneath the cursor while trying to scroll.
    document.addEventListener('pointermove', event => {
      if (tt.contains(event.target)) {
        tooltipHover = true;
        event.stopImmediatePropagation();
      }
    }, true);

    tt.addEventListener('pointerenter', () => { tooltipHover = true; });
    tt.addEventListener('pointerleave', event => {
      tooltipHover = false;
      const to = event.relatedTarget;
      if (to && to.closest && to.closest('.seg, .cbseg')) return;
      if (typeof root.hideTT === 'function') root.hideTT();
      else {
        tt.style.display = 'none';
        tt.setAttribute('aria-hidden', 'true');
      }
    });

    if (typeof root.positionTT === 'function' && !root.positionTT.__cgTimelineEnhancement) {
      const originalPosition = root.positionTT;
      const wrappedPosition = function wrappedPositionTT(x, y) {
        if (tooltipHover) return;
        return originalPosition.call(this, x, y);
      };
      wrappedPosition.__cgTimelineEnhancement = true;
      root.positionTT = wrappedPosition;
    }
  }

  function monitorRowForOrb(orb) {
    if (!orb) return null;
    const rep = orb.dataset.rep || '';
    const wk = orb.dataset.wk || '';
    if (!rep || !wk || typeof root.qaMonitorRowsForRepWeek !== 'function') return null;

    const rows = root.qaMonitorRowsForRepWeek(rep, wk) || [];
    if (!rows.length) return null;

    const scope = orb.closest('.timelineWrap') || orb.parentElement || document;
    const same = Array.from(scope.querySelectorAll('.weekOrb.monitor')).filter(node =>
      (node.dataset.rep || '') === rep && (node.dataset.wk || '') === wk
    );
    const monitorIndex = Math.max(0, same.indexOf(orb));
    return rows[monitorIndex] || rows[0] || null;
  }

  function decorateMonitorOrbs() {
    document.querySelectorAll('.weekOrb.monitor').forEach(orb => {
      const row = monitorRowForOrb(orb);
      const flag = row ? parseReadFlag(row.readFlag) : null;
      orb.classList.toggle('cgMonitorReviewed', flag === 1);
      orb.classList.toggle('cgMonitorUnread', flag === 0);

      if (row) {
        const review = flag === 1 ? 'Reviewed' : (flag === 0 ? 'Not reviewed' : 'Review status unknown');
        const score = Number.isFinite(Number(row.score)) ? `${(Number(row.score) * 100).toFixed(1)}%` : '—';
        const queue = row.queueName || clean(pick(row, ['Queue Name', 'queue_name', 'queue'])) || '—';
        const durationRaw = row.interactionDuration || clean(pick(row, ['Interaction Duration', 'duration'])) || '—';
        const duration = formatInteractionDuration(durationRaw);
        orb.title = `${review} • Score ${score} • Duration ${duration} • Queue ${queue}`;
      }
    });
  }

  function replaceWeekNumberLabels() {
    document.querySelectorAll('.timelineWrap').forEach(scope => {
      const weekKeys = Array.from(new Set(Array.from(scope.querySelectorAll('[data-wk]'))
        .map(node => clean(node.dataset.wk))
        .filter(Boolean)));
      if (!weekKeys.length) return;

      const byNumber = new Map();
      weekKeys.forEach(wk => {
        const match = /-W(\d{1,2})$/i.exec(wk);
        if (match) byNumber.set(Number(match[1]), wk);
      });

      scope.querySelectorAll('*').forEach(node => {
        if (node.children.length) return;
        const match = /^W(\d{1,2})$/i.exec(clean(node.textContent));
        if (!match) return;
        const wk = byNumber.get(Number(match[1]));
        if (!wk) return;
        const label = weekSundayLabel(wk);
        if (!label || label === '—') return;
        node.textContent = label;
        node.title = `Week beginning Sunday ${label}`;
        node.dataset.cgWeekKey = wk;
      });
    });
  }

  function decorate() {
    decorateQueued = false;
    replaceWeekNumberLabels();
    decorateMonitorOrbs();
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    (root.requestAnimationFrame || root.setTimeout)(decorate);
  }

  function enhanceMonitorModal(orb) {
    const row = monitorRowForOrb(orb);
    if (!row) return;

    const body = document.getElementById('itemModalBody');
    const meta = document.getElementById('itemModalMeta');
    if (!body) return;

    const score = Number.isFinite(Number(row.score)) ? `${(Number(row.score) * 100).toFixed(1)}%` : '—';
    const durationRaw = row.interactionDuration || clean(pick(row, ['Interaction Duration', 'duration'])) || '—';
    const duration = formatInteractionDuration(durationRaw);
    const evaluator = row.evaluator || clean(pick(row, ['Evaluator Name', 'evaluatorname', 'evaluator'])) || '—';
    const conversationId = (typeof root.qaConversationId === 'function' ? root.qaConversationId(row) : '') || '—';
    const queueName = row.queueName || clean(pick(row, ['Queue Name', 'queue_name', 'queue'])) || '—';
    const startLabel = typeof root.qaInteractionStartLabel === 'function'
      ? root.qaInteractionStartLabel(row)
      : clean(pick(row, ['Interaction Start Time', 'interactionstarttime', 'date'])) || '—';
    const sunday = weekSundayLabel(orb.dataset.wk || '');

    if (meta) meta.textContent = `${sunday} • ${startLabel} • Score ${score}`;
    body.innerHTML = `
      <div class="mCard">
        <div class="mini">
          <span class="pill">Score: <strong>${esc(score)}</strong></span>
          <span class="pill">Interaction Duration: <strong>${esc(duration)}</strong></span>
          <span class="pill">Evaluator: <strong>${esc(evaluator)}</strong></span>
          <span class="pill">Conversation ID: <strong>${esc(conversationId)}</strong></span>
          <span class="pill">Queue Name: <strong>${esc(queueName)}</strong></span>
          <span class="pill">Interaction Start Time: <strong>${esc(startLabel)}</strong></span>
        </div>
      </div>
    `;
  }

  function installMonitorClickEnhancement() {
    document.addEventListener('click', event => {
      const orb = event.target && event.target.closest ? event.target.closest('.weekOrb.monitor') : null;
      if (!orb) return;
      // Allow the existing click handler to open the modal first, then enrich it.
      root.setTimeout(() => enhanceMonitorModal(orb), 0);
    }, true);
  }

  function refreshQaWithEnhancedHeaders() {
    try {
      root.loadQA();
      root.render();
    } catch (_) {}
    scheduleDecorate();
  }

  function install() {
    if (installed) return true;
    if (!required.every(name => typeof root[name] === 'function') || !document.getElementById('tt')) return false;

    patchCanonicalQA();
    patchTooltipWeekHeader();
    addStyles();
    patchTooltipBehavior();
    installMonitorClickEnhancement();

    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, { childList:true, subtree:true });

    installed = true;
    refreshQaWithEnhancedHeaders();
    return true;
  }

  let tries = 0;
  function tryInstall() {
    if (install()) return;
    if (++tries < 120) root.setTimeout(tryInstall, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryInstall, { once:true });
  else tryInstall();
})(window);
