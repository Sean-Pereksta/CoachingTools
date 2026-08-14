(function loadCoachToolsProfileFastV2() {
  'use strict';
  if (typeof document === 'undefined') return;
  const current = document.currentScript;
  const source = current && current.src
    ? current.src.replace(/coachtools-profile-fast\.js(?:\?.*)?$/i, 'coachtools-profile-fast-v2.js')
    : '../shared/coachtools-profile-fast-v2.js';
  document.write('<script src="' + String(source).replace(/"/g, '&quot;') + '"><\/script>');
})();
