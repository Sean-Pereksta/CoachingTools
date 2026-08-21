(function loadCoachToolsProfileFastV2() {
  'use strict';
  if (typeof document === 'undefined') return;
  const current = document.currentScript;
  const from = name => current && current.src
    ? current.src.replace(/coachtools-profile-fast\.js(?:\?.*)?$/i, name)
    : `../shared/${name}`;
  const write = source => document.write('<script src="' + String(source).replace(/"/g, '&quot;') + '"><\/script>');
  write(from('coachtools-calculation-alignment.js'));
  write(from('coachtools-profile-fast-v2.js'));
  write(from('coachtools-calculation-alignment-post.js'));
})();
