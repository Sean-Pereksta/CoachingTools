(function installCoachingGapsLayout(root) {
  'use strict';

  const appId = document.querySelector('meta[name="coachtools-id"]')?.content || '';
  if (appId !== 'coaching-gaps') return;

  function applyLayout() {
    if (document.documentElement.dataset.coachingGapsLayoutV2 === '1') return;

    const presetStrip = document.getElementById('presetStrip');
    const minCoverageInput = document.getElementById('minCovInp');
    const controlGrid = document.querySelector('#topPanel .controlGrid');
    const coachingTypeSelect = document.getElementById('coachingTypeFilterSel');
    const selectAllBtn = document.getElementById('typesAllBtn');
    const selectNoneBtn = document.getElementById('typesNoneBtn');

    if (!presetStrip || !minCoverageInput || !controlGrid || !coachingTypeSelect || !selectAllBtn || !selectNoneBtn) return;

    document.documentElement.dataset.coachingGapsLayoutV2 = '1';

    const style = document.createElement('style');
    style.id = 'coaching-gaps-layout-v2';
    style.textContent = `
      #topPanel .controlGrid {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      #topPanel .filterPanel,
      #topPanel .filterAdvanced,
      #topPanel .filterStateCard {
        grid-column: 1 !important;
      }
      .presetCoverage {
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;
        margin-left: 4px;
        padding-left: 10px;
        border-left: 1px solid #dbe3ee;
        white-space: nowrap;
        color: var(--muted);
      }
      .presetCoverage > span {
        color: var(--muted);
        font-size: 10px;
        font-weight: 850;
        letter-spacing: .055em;
        text-transform: uppercase;
      }
      .presetCoverage #minCovInp {
        width: 62px;
        max-width: 62px;
        height: 32px;
        padding: 5px 7px;
        border: 1px solid #dbe3ee;
        border-radius: 9px;
        background: #fff;
        text-align: center;
        font-size: 12px;
        font-weight: 850;
      }
      .coachingTypePrimaryGrid {
        grid-template-columns: minmax(180px, 1fr) auto !important;
      }
      .coachingBulkActions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
        padding: 9px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #fff;
      }
      .coachingBulkActionsLabel {
        margin-right: auto;
        color: var(--muted);
        font-size: 10px;
        font-weight: 850;
        letter-spacing: .055em;
        text-transform: uppercase;
      }
      @media (max-width: 760px) {
        .presetCoverage {
          margin-left: 0;
          padding-left: 8px;
        }
        .coachingTypePrimaryGrid {
          grid-template-columns: 1fr !important;
        }
      }
    `;
    document.head.appendChild(style);

    // Keep the filter drawer in one simple reading order: Documented Coaching,
    // then Checklist, then the less-used advanced controls.
    controlGrid.style.gridTemplateColumns = 'minmax(0, 1fr)';

    // Surface KPI coverage in the second toolbar alongside Quick Focus presets.
    const coverageLabel = minCoverageInput.closest('label');
    const presetSpacer = presetStrip.querySelector('.presetSpacer');
    if (coverageLabel) {
      coverageLabel.classList.remove('topControl', 'topCoverage');
      coverageLabel.classList.add('presetCoverage');
      if (presetSpacer) presetStrip.insertBefore(coverageLabel, presetSpacer);
      else presetStrip.appendChild(coverageLabel);
    }

    // Make the primary documented-coaching row only about choosing/applying a type.
    const primaryTypeGrid = coachingTypeSelect.closest('.filterGrid');
    if (primaryTypeGrid) primaryTypeGrid.classList.add('coachingTypePrimaryGrid');

    // Bulk chip controls belong under Additional options, next to the coaching-type
    // customization they affect, rather than beside the primary selector.
    const coachingPanel = coachingTypeSelect.closest('.filterPanel');
    const additionalOptions = coachingPanel?.querySelector('details');
    const additionalSummary = additionalOptions?.querySelector('summary');
    if (additionalOptions && additionalSummary) {
      const bulkActions = document.createElement('div');
      bulkActions.className = 'coachingBulkActions';
      bulkActions.setAttribute('aria-label', 'Documented coaching type chip options');

      const bulkLabel = document.createElement('span');
      bulkLabel.className = 'coachingBulkActionsLabel';
      bulkLabel.textContent = 'Coaching type chips';

      bulkActions.append(bulkLabel, selectAllBtn, selectNoneBtn);
      additionalSummary.insertAdjacentElement('afterend', bulkActions);
    }

    // Coverage is no longer an advanced setting, so keep that description accurate.
    const advancedPanel = document.getElementById('multiViewDetails')?.closest('.filterPanel');
    const advancedSub = advancedPanel?.querySelector('.filterPanelSub');
    if (advancedSub) advancedSub.textContent = 'Secondary KPI and manual refresh.';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLayout, { once: true });
  } else {
    applyLayout();
  }
})(window);
