(function attachCoachToolsDiagnostics(root) {
  'use strict';

  try {
    if (root.parent && root.parent !== root && root.parent.CoachToolsDiagnostics) {
      root.CoachToolsDiagnostics = root.parent.CoachToolsDiagnostics;
      return;
    }
  } catch (_) {}

  const VERSION = '1.0.0';
  const starts = new Map();
  const entries = [];
  const now = () => root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now();

  function start(name, detail) {
    const key = String(name || 'operation');
    starts.set(key, { at: now(), detail: detail || null });
    try { root.performance.mark(`coachtools:${key}:start`); } catch (_) {}
    return key;
  }

  function end(name, detail) {
    const key = String(name || 'operation');
    const started = starts.get(key);
    const duration = Math.max(0, now() - (started ? started.at : now()));
    starts.delete(key);
    const entry = { name: key, duration, at: new Date().toISOString(), detail: detail || started && started.detail || null };
    entries.push(entry);
    if (entries.length > 80) entries.splice(0, entries.length - 80);
    try {
      root.performance.mark(`coachtools:${key}:end`);
      root.performance.measure(`coachtools:${key}`, `coachtools:${key}:start`, `coachtools:${key}:end`);
    } catch (_) {}
    return entry;
  }

  async function measure(name, operation, detail) {
    start(name, detail);
    try { return await operation(); }
    finally { end(name); }
  }

  root.CoachToolsDiagnostics = Object.freeze({
    VERSION, start, end, measure,
    getEntries: () => entries.slice().sort((left, right) => Date.parse(right.at) - Date.parse(left.at)),
    clear: () => { entries.length = 0; starts.clear(); }
  });
})(window);
