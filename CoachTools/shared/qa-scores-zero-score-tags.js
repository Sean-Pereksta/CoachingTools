(function installQaZeroScoreTags(root) {
  'use strict';

  const appId = document.querySelector('meta[name="coachtools-id"]')?.content || '';
  if (appId !== 'qa-scores') return;

  let observer = null;

  function ensureStyles() {
    if (document.getElementById('qaZeroScoreTagStyles')) return;
    const style = document.createElement('style');
    style.id = 'qaZeroScoreTagStyles';
    style.textContent = `
      .qaZeroScoreTag{
        display:inline-flex;
        align-items:center;
        gap:5px;
        width:max-content;
        margin-top:6px;
        padding:3px 7px;
        border-radius:999px;
        border:1px solid rgba(220,38,38,.30);
        background:rgba(220,38,38,.10);
        color:#991b1b;
        font-size:10px;
        font-weight:950;
        line-height:1.2;
        letter-spacing:.045em;
        text-transform:uppercase;
      }
      .qaZeroScoreTag::before{
        content:'!';
        display:inline-grid;
        place-items:center;
        width:14px;
        height:14px;
        border-radius:50%;
        background:currentColor;
        color:#fff;
        font-size:10px;
        line-height:1;
      }
      body.qaGalactic .qaZeroScoreTag{
        border-color:rgba(255,84,112,.42);
        background:rgba(255,84,112,.14);
        color:#ffb3c0;
        box-shadow:0 0 14px rgba(255,84,112,.10);
      }
      body.qaGalactic .qaZeroScoreTag::before{
        color:#120b25;
      }
    `;
    document.head.appendChild(style);
  }

  function currentRows() {
    try {
      return typeof root.filterRows === 'function' ? root.filterRows() : [];
    } catch (_) {
      return [];
    }
  }

  function zeroCountsByRep(rows) {
    const counts = new Map();
    for (const row of rows || []) {
      const score = Number(row?.score);
      if (!Number.isFinite(score) || score !== 0) continue;
      const key = String(row?.agentKey || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function decorateCards() {
    const cardsRoot = document.getElementById('cards');
    if (!cardsRoot) return;

    const counts = zeroCountsByRep(currentRows());
    cardsRoot.querySelectorAll('.repCard[data-rep]').forEach(card => {
      const repKey = String(card.dataset.rep || '').trim();
      const zeroCount = counts.get(repKey) || 0;
      let tag = card.querySelector('.qaZeroScoreTag');

      if (!zeroCount) {
        if (tag) tag.remove();
        return;
      }

      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'qaZeroScoreTag';
        const meta = card.querySelector('.repMeta');
        if (meta) meta.insertAdjacentElement('afterend', tag);
        else (card.querySelector('.repTop > div') || card).appendChild(tag);
      }

      tag.textContent = zeroCount === 1 ? '0 score call' : `0 score calls ×${zeroCount}`;
      tag.title = zeroCount === 1
        ? 'This representative had a QA call scored 0 in the current time period.'
        : `This representative had ${zeroCount} QA calls scored 0 in the current time period.`;
      tag.setAttribute('aria-label', tag.title);
    });
  }

  function install(attempt) {
    const cardsRoot = document.getElementById('cards');
    if (!cardsRoot || typeof root.filterRows !== 'function') {
      if ((attempt || 0) < 60) root.setTimeout(() => install((attempt || 0) + 1), 150);
      return;
    }

    ensureStyles();
    decorateCards();

    if (!observer) {
      observer = new MutationObserver(() => decorateCards());
      observer.observe(cardsRoot, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install(0), { once: true });
  } else {
    install(0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
