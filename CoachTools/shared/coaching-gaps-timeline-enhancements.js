(function installCoachingGapsTimelineTooltip(root) {
  'use strict';

  if ((document.querySelector('meta[name="coachtools-id"]')?.content || '') !== 'coaching-gaps') return;

  let tooltipHover = false;

  function patchTooltipBehavior() {
    const tt = document.getElementById('tt');
    if (!tt || tt.dataset.cgScrollable === '1') return;
    tt.dataset.cgScrollable = '1';

    // Prevent the app's document-level pointerout handler from closing the tooltip
    // during the handoff from the blue KPI/coaching segment into the popup.
    document.addEventListener('pointerout', event => {
      const from = event.target && event.target.closest ? event.target.closest('.seg, .cbseg') : null;
      if (!from) return;
      const to = event.relatedTarget;
      if (to && tt.contains(to)) {
        tooltipHover = true;
        event.stopImmediatePropagation();
      }
    }, true);

    // The stock tooltip follows the pointer. Freeze it while the user is inside it,
    // otherwise the popup would move underneath the cursor while trying to scroll.
    document.addEventListener('pointermove', event => {
      if (tt.contains(event.target)) {
        tooltipHover = true;
        event.stopImmediatePropagation();
      }
    }, true);

    tt.addEventListener('pointerenter', () => { tooltipHover = true; });
    tt.addEventListener('pointerleave', event => {
      tooltipHover = false;
      const to = event.relatedTarget;
      if (to && to.closest && to.closest('.seg, .cbseg')) return;
      if (typeof root.hideTT === 'function') root.hideTT();
      else {
        tt.style.display = 'none';
        tt.setAttribute('aria-hidden', 'true');
      }
    });

    if (typeof root.positionTT === 'function' && !root.positionTT.__cgTimelineEnhancement) {
      const originalPosition = root.positionTT;
      const wrappedPosition = function wrappedPositionTT(x, y) {
        if (tooltipHover) return;
        return originalPosition.call(this, x, y);
      };
      wrappedPosition.__cgTimelineEnhancement = true;
      root.positionTT = wrappedPosition;
    }
  }

  const style = document.createElement('style');
  style.textContent = '.tt{pointer-events:auto !important;overflow-y:auto !important;overscroll-behavior:contain;scrollbar-gutter:stable}';
  document.head.appendChild(style);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchTooltipBehavior, { once:true });
  else patchTooltipBehavior();
})(window);
