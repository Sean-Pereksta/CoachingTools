(function attachCoachToolsRememberedScope(root) {
  'use strict';

  const importer = root.CoachToolsImport;
  if (!importer || typeof importer.saveRecognizedEntry !== 'function') return;

  function reusableCurrentScope() {
    const storage = root.CoachToolsStorage;
    if (!storage || typeof storage.getScope !== 'function') return null;
    const scope = storage.getScope();
    if (!scope) return null;
    if (scope.mode === 'all') return scope;
    return Array.isArray(scope.coaches) && scope.coaches.length ? scope : null;
  }

  const originalSaveRecognizedEntry = importer.saveRecognizedEntry.bind(importer);
  const scopedImporter = {
    ...importer,
    async saveRecognizedEntry(entry, options) {
      const nextOptions = { ...(options || {}) };
      // The remembered-folder updater intentionally passes scope:null. Replace
      // that with the currently saved desktop scope so an update does not widen
      // coach/team/coordinator data back to the full organization. QA remains
      // department-wide because prepareDataset intentionally ignores scope for QA.
      if (Object.prototype.hasOwnProperty.call(nextOptions, 'scope') && nextOptions.scope === null) {
        nextOptions.scope = reusableCurrentScope();
      }
      return originalSaveRecognizedEntry(entry, nextOptions);
    }
  };

  root.CoachToolsImport = Object.freeze(scopedImporter);
})(window);
