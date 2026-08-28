(function installPerformanceScorecardGoals(root) {
  'use strict';

  const STORAGE_KEY = 'coachtools.performanceScorecard.goals.v1';
  const EVENT_NAME = 'coachtools:scorecard-goals-changed';
  const DEFAULTS = Object.freeze({
    'consumer-rate': Object.freeze({ id: 'consumer-rate', label: 'Consumer AR', goal: 0.47, direction: 'higher', format: 'percent', step: 0.1 }),
    'insurance-rate': Object.freeze({ id: 'insurance-rate', label: 'Insurance AR', goal: 0.92, direction: 'higher', format: 'percent', step: 0.1 }),
    'commercial-rate': Object.freeze({ id: 'commercial-rate', label: 'Commercial AR', goal: 0.85, direction: 'higher', format: 'percent', step: 0.1 }),
    'referral-rate': Object.freeze({ id: 'referral-rate', label: 'Referral AR', goal: 0.47, direction: 'higher', format: 'percent', step: 0.1 }),
    'wiper-rate': Object.freeze({ id: 'wiper-rate', label: 'Wiper Rate', goal: 0.23, direction: 'higher', format: 'percent', step: 0.1 }),
    'call-quality': Object.freeze({ id: 'call-quality', label: 'Call Quality / QA', goal: 0.85, direction: 'higher', format: 'percent', step: 0.1 }),
    'consumer-opps': Object.freeze({ id: 'consumer-opps', label: 'Consumer Opps', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'insurance-opps': Object.freeze({ id: 'insurance-opps', label: 'Insurance Opps', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'commercial-opps': Object.freeze({ id: 'commercial-opps', label: 'Commercial Opps', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'wiper-volume': Object.freeze({ id: 'wiper-volume', label: 'Wiper Volume', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'qa-monitors': Object.freeze({ id: 'qa-monitors', label: 'QA Monitors', goal: 1, direction: 'higher', format: 'count', step: 1 }),
    'coaching-30': Object.freeze({ id: 'coaching-30', label: 'Coachings 30d', goal: 1, direction: 'higher', format: 'count', step: 1 }),
    'checklist-30': Object.freeze({ id: 'checklist-30', label: 'Checklist 30d', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'open-checklist': Object.freeze({ id: 'open-checklist', label: 'Open Checklist', goal: 0, direction: 'lower', format: 'count', step: 1 }),
    'days-since-coaching': Object.freeze({ id: 'days-since-coaching', label: 'Last Coaching', goal: 7, direction: 'lower', format: 'duration', step: 1 }),
    'kpi-history': Object.freeze({ id: 'kpi-history', label: 'KPI History', goal: 4, direction: 'higher', format: 'count', step: 1 })
  });
  const ALIASES = Object.freeze({
    consumer: 'consumer-rate', insurance: 'insurance-rate', commercial: 'commercial-rate',
    referral: 'referral-rate', wiper: 'wiper-rate', qa: 'call-quality'
  });

  function canonicalId(id) {
    const key = String(id == null ? '' : id).trim();
    return ALIASES[key] || key;
  }
  function load() {
    try {
      const parsed = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }
  let overrides = load();
  function persist() {
    try { root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch (_) {}
  }
  function definition(id) {
    const canonical = canonicalId(id), base = DEFAULTS[canonical];
    if (!base) return null;
    const saved = overrides[canonical] && typeof overrides[canonical] === 'object' ? overrides[canonical] : {};
    const goal = saved.goal === null || Number.isFinite(Number(saved.goal)) ? (saved.goal === null ? null : Number(saved.goal)) : base.goal;
    const direction = saved.direction === 'lower' || saved.direction === 'higher' ? saved.direction : base.direction;
    return { ...base, goal, direction };
  }
  function dispatch(id) {
    if (typeof root.dispatchEvent !== 'function' || typeof root.CustomEvent !== 'function') return;
    root.dispatchEvent(new root.CustomEvent(EVENT_NAME, { detail: { id: canonicalId(id), definition: definition(id) } }));
  }
  function set(id, changes) {
    const canonical = canonicalId(id), base = DEFAULTS[canonical];
    if (!base) return null;
    const current = definition(canonical), next = { goal: current.goal, direction: current.direction };
    if (changes && Object.prototype.hasOwnProperty.call(changes, 'goal')) {
      const value = changes.goal;
      next.goal = value === '' || value == null ? null : Number(value);
      if (next.goal !== null && !Number.isFinite(next.goal)) return current;
    }
    if (changes?.direction === 'higher' || changes?.direction === 'lower') next.direction = changes.direction;
    overrides[canonical] = next;
    persist();
    dispatch(canonical);
    return definition(canonical);
  }
  function reset(id) {
    const canonical = canonicalId(id);
    delete overrides[canonical];
    persist();
    dispatch(canonical);
    return definition(canonical);
  }
  function resetAll() {
    overrides = {};
    persist();
    dispatch('*');
  }
  function evaluate(id, value) {
    const config = definition(id), numeric = Number(value);
    if (!config || !Number.isFinite(numeric) || !Number.isFinite(config.goal)) return 'neutral';
    return config.direction === 'lower' ? (numeric <= config.goal ? 'success' : 'opportunity') : (numeric >= config.goal ? 'success' : 'opportunity');
  }
  function inputValue(id) {
    const config = definition(id);
    if (!config || !Number.isFinite(config.goal)) return '';
    return config.format === 'percent' ? String(Math.round(config.goal * 1000) / 10) : String(config.goal);
  }
  function fromInput(id, value) {
    const config = definition(id);
    if (!config || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return NaN;
    return config.format === 'percent' ? numeric / 100 : numeric;
  }
  function format(id, value) {
    const config = definition(id), numeric = value === undefined ? config?.goal : Number(value);
    if (!config || !Number.isFinite(numeric)) return 'No goal';
    if (config.format === 'percent') return `${(numeric * 100).toFixed(1)}%`;
    if (config.format === 'duration') return `${Math.round(numeric)}d`;
    return Number.isInteger(numeric) ? numeric.toLocaleString() : numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  root.CoachToolsPerformanceScorecardGoals = Object.freeze({
    VERSION: '1.0.0', STORAGE_KEY, EVENT_NAME, DEFAULTS, canonicalId, definition, set, reset, resetAll,
    evaluate, inputValue, fromInput, format
  });
})(typeof window !== 'undefined' ? window : globalThis);
