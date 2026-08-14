(function loadCoachToolsIntelligenceExtensionsV2() {
  'use strict';
  if (typeof document === 'undefined') return;
  const current = document.currentScript;
  const source = current && current.src
    ? current.src.replace(/coachtools-intelligence-extensions\.js(?:\?.*)?$/i, 'coachtools-intelligence-extensions-v2.js')
    : '../shared/coachtools-intelligence-extensions-v2.js';
  document.write('<script src="' + String(source).replace(/"/g, '&quot;') + '"><\/script>');
})();
