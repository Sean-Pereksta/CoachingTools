(function loadCoachToolsIntelligenceExtensionsV2() {
  'use strict';
  if (typeof document === 'undefined') return;
  const current = document.currentScript;
  const from = name => current && current.src
    ? current.src.replace(/coachtools-intelligence-extensions\.js(?:\?.*)?$/i, name)
    : `../shared/${name}`;
  const write = source => document.write('<script src="' + String(source).replace(/"/g, '&quot;') + '"><\/script>');
  const append = source => {
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  };
  write(from('coachtools-calculation-alignment.js'));
  write(from('coachtools-intelligence-extensions-v2.js'));
  write(from('coachtools-calculation-alignment-post.js'));

  const appId = document.querySelector('meta[name="coachtools-id"]')?.content || '';
  if (appId === 'coaching-gaps') append(from('coaching-gaps-list-analysis.js'));
})();
