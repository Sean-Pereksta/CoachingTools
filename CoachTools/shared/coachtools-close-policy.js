(function attachCoachToolsClosePolicy(root) {
  'use strict';

  const policy = Object.freeze({
    allStarReleaseMs: 48,
    allStarDeadlineMs: 160,
    slowCloseMs: 50,
    allStarPersistencePlan(state) {
      const input = state || {};
      const dirty = Boolean(input.dirty);
      const saveAlreadyRunning = Boolean(input.saveAlreadyRunning);
      const workActive = Boolean(input.centralSyncActive || input.importCacheLoading);
      return Object.freeze({
        dirty,
        saveAlreadyRunning,
        shouldQueueDirtySave: dirty && !saveAlreadyRunning && !workActive,
        waitForPersistence: false
      });
    }
  });

  root.CoachToolsClosePolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis);
