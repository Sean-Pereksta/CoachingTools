(function attachCoachToolsSync(root) {
  'use strict';

  function text(value) { return String(value == null ? '' : value); }

  function periodSort(value) {
    const raw = text(value).trim();
    if (!raw) return '';
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
  }

  function compareCandidate(candidate, current, history) {
    const next = candidate || {};
    const existing = Array.isArray(history) ? history : [];
    const fingerprint = text(next.fingerprint);
    const periodKey = text(next.periodKey);
    const nextSort = periodSort(next.periodSort || next.sortKey || periodKey || next.importedAt);

    if (!next.datasetType || !fingerprint) {
      return { status: 'needs-review', reason: 'Dataset type or fingerprint is missing.', becomesCurrent: false };
    }

    const duplicate = existing.find(record => text(record.fingerprint) === fingerprint);
    if (duplicate) {
      return { status: 'current', reason: 'Identical fingerprint already imported.', becomesCurrent: false, matchingDatasetId: duplicate.id || duplicate.datasetId || '' };
    }

    if (!current) return { status: 'new', reason: 'No current dataset exists.', becomesCurrent: true };

    const currentKey = text(current.periodKey);
    const currentSort = periodSort(current.periodSort || current.sortKey || currentKey || current.importedAt);
    if (periodKey && currentKey && periodKey === currentKey) {
      return { status: 'updated', reason: 'The reporting period matches but the contents changed.', becomesCurrent: true, replacesDatasetId: current.datasetId || current.id || '' };
    }
    if (nextSort && currentSort && nextSort > currentSort) {
      return { status: 'new', reason: 'A newer reporting period was detected.', becomesCurrent: true };
    }
    if (nextSort && currentSort && nextSort < currentSort) {
      return { status: 'older', reason: 'An older reporting period was detected.', becomesCurrent: false };
    }
    return { status: 'needs-review', reason: 'The reporting period could not be compared safely.', becomesCurrent: false };
  }

  root.CoachToolsSync = Object.freeze({ VERSION: '1.0.0', compareCandidate, periodSort });
})(typeof window !== 'undefined' ? window : globalThis);
