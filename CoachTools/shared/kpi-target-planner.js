(function(root, factory){
  'use strict';
  const service = factory();
  if(typeof module === 'object' && module.exports) module.exports = service;
  else root.KpiTargetPlanner = service;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const tolerance = value => Math.min(1e-7, Number.EPSILON * 32 * Math.max(1, Math.abs(value)));
  const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) ? Number(value) : NaN;
  const failure = (code, error) => ({ok:false, code, error, rows:[]});

  // Opportunities stay fixed. Additional outcomes are shared by opportunity volume,
  // redistributing a representative's share once their available capacity is full.
  function plan(inputRows, targetPercent, selectedNames){
    const percent = number(targetPercent);
    if(!Number.isFinite(percent) || percent < 0 || percent > 100){
      return failure('invalid-target', 'Enter a target percentage from 0 to 100.');
    }
    if(!Array.isArray(inputRows)) return failure('invalid-data', 'The calculator needs representative KPI counts.');
    if(selectedNames != null && (typeof selectedNames === 'string' || typeof selectedNames[Symbol.iterator] !== 'function')){
      return failure('invalid-selection', 'Choose the representatives to include in the coaching plan.');
    }
    const selected = selectedNames == null ? null : new Set(Array.from(selectedNames, String));
    const names = new Set(), rows = [];
    let totalApps = 0, totalOpps = 0;
    for(const input of inputRows){
      const rep = String(input?.rep ?? '').trim();
      const apps = number(input?.apps), opps = number(input?.opps);
      if(!rep || names.has(rep) || !Number.isFinite(apps) || !Number.isFinite(opps) || apps < 0 || opps < 0){
        return failure('invalid-data', 'Each representative needs a unique name and nonnegative KPI counts.');
      }
      if(apps > opps + tolerance(opps)){
        return failure('unsupported-ratio', 'This calculator needs a percentage KPI with outcomes no greater than opportunities. Choose another KPI.');
      }
      names.add(rep);
      totalApps += apps;
      totalOpps += opps;
      if(totalApps > Number.MAX_SAFE_INTEGER || totalOpps > Number.MAX_SAFE_INTEGER){
        return failure('invalid-data', 'These KPI totals are too large to calculate reliably.');
      }
      const isSelected = selected == null || selected.has(rep);
      rows.push({rep, apps, opps, selected:isSelected, capacity:isSelected ? Math.max(0, Math.floor(opps - apps + tolerance(opps))) : 0, extra:0});
    }
    if(totalOpps <= 0) return failure('no-opportunities', 'Choose a team and KPI with opportunities in the selected window.');

    const targetRate = percent / 100;
    const requiredApps = targetRate * totalOpps;
    const needed = Math.max(0, Math.ceil(requiredApps - totalApps - tolerance(Math.max(requiredApps, totalApps))));
    const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
    let remaining = Math.min(needed, capacity);
    while(remaining > 0){
      const available = rows.filter(row => row.capacity > row.extra && row.opps > 0);
      const weight = available.reduce((sum, row) => sum + row.opps, 0);
      if(!available.length || !weight) break;
      const shares = available.map((row, index) => ({row, index, share:remaining * row.opps / weight}));
      const capped = shares.filter(({row, share}) => share >= row.capacity - row.extra);
      if(capped.length){
        for(const {row} of capped){
          const extra = row.capacity - row.extra;
          row.extra += extra;
          remaining -= extra;
        }
        continue;
      }
      for(const part of shares){
        const extra = Math.floor(part.share);
        part.row.extra += extra;
        part.fraction = part.share - extra;
        remaining -= extra;
      }
      // Largest remainder keeps every outcome whole and the total exact. Original
      // row order breaks ties so names/locale never change the allocation.
      shares.sort((a,b) => b.fraction - a.fraction || a.index - b.index);
      for(const {row} of shares){
        if(remaining === 0) break;
        if(row.extra < row.capacity){ row.extra++; remaining--; }
      }
    }
    const allocated = rows.reduce((sum, row) => sum + row.extra, 0);
    const shortfall = Math.max(0, needed - allocated);
    for(const row of rows){
      row.currentRate = row.opps > 0 ? row.apps / row.opps : null;
      row.targetApps = row.apps + row.extra;
      row.targetRate = row.opps > 0 ? row.targetApps / row.opps : null;
    }
    return {
      ok:true, code:null, error:null, totalApps, totalOpps,
      currentRate:totalApps / totalOpps, targetRate, needed, capacity, allocated,
      shortfall, remaining:shortfall, possible:shortfall === 0,
      projectedRate:(totalApps + allocated) / totalOpps,
      selectedCount:rows.filter(row => row.selected).length, rows
    };
  }

  return Object.freeze({plan});
});
