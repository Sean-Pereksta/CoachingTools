(function attachCoachToolsInsightUI(root) {
  'use strict';

  const VERSION = '1.0.0';
  const state = { appId:'', personId:'', payload:null, refreshTimer:null, mounted:false };
  const insightScript = document.currentScript;
  const sharedBase = insightScript && insightScript.src ? new URL('.', insightScript.src) : null;

  function esc(value){ return String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function dateText(value){ if(!value)return '—'; const d=value instanceof Date?value:new Date(value); return Number.isNaN(d.getTime())?'—':d.toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}); }
  function pct(value){ return root.CoachToolsIntelligence&&root.CoachToolsIntelligence.formatPercent?root.CoachToolsIntelligence.formatPercent(value):Number.isFinite(value)?`${(value*100).toFixed(1)}%`:'—'; }
  function outcomeChange(row){
    if(!Number.isFinite(row&&row.delta)) return '—';
    if(row.metricId==='aht') return `${row.delta>0?'+':''}${row.delta.toFixed(0)}`;
    return `${row.delta>0?'+':''}${(row.delta*100).toFixed(1)} pts`;
  }
  function statusLabel(status){ return ({open:'Open','coached-watching':'Coached · Watching',resolved:'Resolved',recurred:'Recurred'})[status]||String(status||'').replace(/-/g,' '); }
  function statusTone(status){ return status==='recurred'?'bad':status==='open'?'warn':status==='resolved'?'good':'info'; }

  function addStyles(){
    if(document.getElementById('coachtoolsInsightStyles')) return;
    const style=document.createElement('style'); style.id='coachtoolsInsightStyles'; style.textContent=`
      #coachtoolsInsightSignal{position:fixed;right:16px;bottom:16px;z-index:2147482000;max-width:min(410px,calc(100vw - 32px));border:1px solid #d8e1e8;border-radius:14px;background:rgba(255,255,255,.97);box-shadow:0 16px 46px rgba(15,23,42,.18);padding:10px 12px;display:flex;align-items:center;gap:10px;text-align:left;color:#172433;font:12px/1.35 Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(12px)}
      #coachtoolsInsightSignal[hidden]{display:none} #coachtoolsInsightSignal:hover{transform:translateY(-1px)}
      #coachtoolsInsightSignal .ctiDot{width:10px;height:10px;border-radius:999px;flex:0 0 10px;background:#247bb5;box-shadow:0 0 0 4px rgba(36,123,181,.10)}
      #coachtoolsInsightSignal[data-tone="attention"] .ctiDot{background:#c43c39;box-shadow:0 0 0 4px rgba(196,60,57,.11)}
      #coachtoolsInsightSignal[data-tone="watch"] .ctiDot{background:#b87812;box-shadow:0 0 0 4px rgba(184,120,18,.11)}
      #coachtoolsInsightSignal[data-tone="positive"] .ctiDot{background:#16805c;box-shadow:0 0 0 4px rgba(22,128,92,.11)}
      #coachtoolsInsightSignal .ctiCopy{min-width:0;flex:1} #coachtoolsInsightSignal strong{display:block;font-size:12px;font-weight:900} #coachtoolsInsightSignal small{display:block;color:#667786;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #coachtoolsInsightSignal .ctiArrow{font-size:16px;color:#668091}
      #coachtoolsInsightShade{position:fixed;inset:0;z-index:2147482500;background:rgba(15,23,42,.22);opacity:0;pointer-events:none;transition:opacity .16s ease} #coachtoolsInsightShade.open{opacity:1;pointer-events:auto}
      #coachtoolsInsightDrawer{position:fixed;right:0;top:0;bottom:0;z-index:2147482600;width:min(520px,96vw);background:#f7f9fb;border-left:1px solid #d8e1e8;box-shadow:-22px 0 60px rgba(15,23,42,.22);transform:translateX(102%);transition:transform .2s ease;display:grid;grid-template-rows:auto minmax(0,1fr);font:12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;color:#172433} #coachtoolsInsightDrawer.open{transform:translateX(0)}
      .ctiHead{padding:15px 16px;border-bottom:1px solid #d8e1e8;background:rgba(255,255,255,.96);display:flex;align-items:flex-start;gap:10px}.ctiHeadCopy{min-width:0;flex:1}.ctiEyebrow{font-size:9px;font-weight:900;color:#718391;text-transform:uppercase;letter-spacing:.1em}.ctiHead h2{margin:3px 0 0;font-size:18px;letter-spacing:-.02em}.ctiClose{border:1px solid #d8e1e8;background:#fff;border-radius:10px;width:34px;height:34px;cursor:pointer;font-weight:900}.ctiBody{overflow:auto;padding:13px;display:grid;gap:10px}.ctiCard{border:1px solid #dde5ec;border-radius:14px;background:#fff;padding:12px;box-shadow:0 7px 20px rgba(31,55,74,.045)}.ctiCard h3{margin:0 0 7px;font-size:12px}.ctiStory{font-size:12px;line-height:1.55;color:#344b5d}.ctiRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:start;padding:9px 0;border-bottom:1px solid #edf1f4}.ctiRow:last-child{border-bottom:0;padding-bottom:0}.ctiRow:first-child{padding-top:0}.ctiName{font-weight:900}.ctiMeta{color:#718391;font-size:10px;margin-top:2px}.ctiReasons{margin:5px 0 0;padding-left:16px;color:#425a6c;font-size:10px}.ctiReasons li{margin:3px 0}.ctiPill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:900;white-space:nowrap;background:#eef4f7;color:#416176}.ctiPill.bad{background:#fdeceb;color:#a13230}.ctiPill.warn{background:#fff1dd;color:#8b5900}.ctiPill.good{background:#e8f7ef;color:#147050}.ctiPill.info{background:#eaf3fa;color:#246b99}.ctiStats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.ctiStat{border:1px solid #e0e7ec;border-radius:11px;padding:9px;background:#fbfdfe}.ctiStat b{display:block;font-size:16px}.ctiStat span{display:block;color:#718391;font-size:9px;margin-top:2px}.ctiEmpty{padding:16px;text-align:center;color:#718391}
      @media(max-width:620px){#coachtoolsInsightSignal{right:10px;bottom:10px;max-width:calc(100vw - 20px)}.ctiStats{grid-template-columns:1fr}}
    `; document.head.appendChild(style);
  }

  function ensureUi(){
    addStyles();
    let signal=document.getElementById('coachtoolsInsightSignal');
    if(!signal){ signal=document.createElement('button');signal.id='coachtoolsInsightSignal';signal.type='button';signal.hidden=true;signal.innerHTML='<span class="ctiDot"></span><span class="ctiCopy"><strong></strong><small></small></span><span class="ctiArrow">›</span>';document.body.appendChild(signal);signal.addEventListener('click',openDrawer); }
    let shade=document.getElementById('coachtoolsInsightShade'); if(!shade){shade=document.createElement('div');shade.id='coachtoolsInsightShade';document.body.appendChild(shade);shade.addEventListener('click',closeDrawer);}
    let drawer=document.getElementById('coachtoolsInsightDrawer'); if(!drawer){drawer=document.createElement('aside');drawer.id='coachtoolsInsightDrawer';drawer.setAttribute('aria-label','Coaching intelligence details');drawer.innerHTML='<header class="ctiHead"><div class="ctiHeadCopy"><div class="ctiEyebrow">CoachTools Intelligence</div><h2>Details</h2></div><button type="button" class="ctiClose" aria-label="Close">×</button></header><div class="ctiBody"></div>';document.body.appendChild(drawer);drawer.querySelector('.ctiClose').addEventListener('click',closeDrawer);}
    return {signal,shade,drawer};
  }

  function lifecycleHtml(items){
    if(!items||!items.length)return '';
    return `<section class="ctiCard"><h3>Opportunity lifecycle</h3>${items.map(item=>`<div class="ctiRow"><div><div class="ctiName">${esc(item.personName||item.coachName)} · ${esc(item.topic)}</div><div class="ctiMeta">${item.lastCoachedAt?`Last coached ${dateText(item.lastCoachedAt)} · `:''}${esc(item.confidence||'')} confidence</div>${item.attentionReasons&&item.attentionReasons.length?`<ul class="ctiReasons">${item.attentionReasons.slice(0,3).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}</div><span class="ctiPill ${statusTone(item.status)}">${esc(statusLabel(item.status))}</span></div>`).join('')}</section>`;
  }
  function outcomesHtml(rows,title){
    if(!rows||!rows.length)return '';
    const improved=rows.filter(row=>row.status==='improved').length,neutral=rows.filter(row=>row.status==='neutral').length,declined=rows.filter(row=>row.status==='declined').length;
    return `<section class="ctiCard"><h3>${esc(title||'Coaching outcomes')}</h3><div class="ctiStats"><div class="ctiStat"><b>${improved}</b><span>Improved</span></div><div class="ctiStat"><b>${neutral}</b><span>Neutral</span></div><div class="ctiStat"><b>${declined}</b><span>Declined</span></div></div>${rows.slice(0,10).map(row=>`<div class="ctiRow"><div><div class="ctiName">${esc(row.personName)} · ${esc(row.topic)}</div><div class="ctiMeta">${dateText(row.date)} · ${esc(row.metric)} · ${pct(row.before)} → ${pct(row.after)}</div></div><span class="ctiPill ${row.status==='improved'?'good':row.status==='declined'?'bad':'info'}">${esc(row.status)} ${outcomeChange(row)}</span></div>`).join('')}</section>`;
  }
  function effectivenessHtml(rows){
    if(!rows||!rows.length)return '';
    return `<section class="ctiCard"><h3>Coach outcome breakdown</h3>${rows.slice(0,8).map(row=>`<div class="ctiRow"><div><div class="ctiName">${esc(row.coachName||'Coach')} · ${esc(row.topic)}</div><div class="ctiMeta">${row.total} measurable coaching${row.total===1?'':'s'}</div></div><span class="ctiPill ${row.successRate>=.6?'good':row.successRate<.4?'warn':'info'}">${Number.isFinite(row.successRate)?Math.round(row.successRate*100):0}% improved</span></div>`).join('')}</section>`;
  }
  function supportHtml(rows){
    if(!rows||!rows.length)return '';
    return `<section class="ctiCard"><h3>Checklist support load</h3>${rows.slice(0,12).map(row=>`<div class="ctiRow"><div><div class="ctiName">${esc(row.coachName)}</div><div class="ctiMeta">${row.total} items · ${row.served} served · ${row.open} open · avg ${Number.isFinite(row.averageDays)?row.averageDays.toFixed(1):'—'} days</div></div><span class="ctiPill ${row.overThreeDays?'bad':row.open?'warn':'good'}">${row.overThreeDays} &gt; 3 days</span></div>`).join('')}</section>`;
  }

  function renderDrawer(){
    const ui=ensureUi(),payload=state.payload||{}; ui.drawer.querySelector('h2').textContent=payload.detailTitle||payload.title||'Coaching Intelligence';
    const sections=[];
    if(payload.story) sections.push(`<section class="ctiCard"><h3>Recent story</h3><div class="ctiStory">${esc(payload.story)}</div></section>`);
    if(payload.items) sections.push(lifecycleHtml(payload.items));
    if(payload.outcomes) sections.push(outcomesHtml(payload.outcomes,payload.detailTitle));
    if(payload.coachEffectiveness) sections.push(effectivenessHtml(payload.coachEffectiveness));
    if(payload.support) sections.push(supportHtml(payload.support));
    ui.drawer.querySelector('.ctiBody').innerHTML=sections.filter(Boolean).join('')||'<div class="ctiEmpty">No additional high-confidence detail is available.</div>';
  }
  function openDrawer(){ if(!state.payload)return;renderDrawer();const ui=ensureUi();ui.shade.classList.add('open');ui.drawer.classList.add('open'); }
  function closeDrawer(){ const ui=ensureUi();ui.shade.classList.remove('open');ui.drawer.classList.remove('open'); }

  function renderSignal(payload){
    const ui=ensureUi(); state.payload=payload||null;
    if(!payload){ui.signal.hidden=true;closeDrawer();return;}
    ui.signal.hidden=false;ui.signal.dataset.tone=payload.tone||'info';ui.signal.querySelector('strong').textContent=payload.title||'Coaching Intelligence';ui.signal.querySelector('small').textContent=payload.summary||'View details';
  }

  function selectedPersonId(){
    if(state.personId)return state.personId;
    const active=document.querySelector('[data-person-id].active,[data-person-id][aria-selected="true"]'); return active&&active.dataset&&active.dataset.personId||'';
  }
  async function refresh(){
    clearTimeout(state.refreshTimer); state.refreshTimer=null;
    if(!root.CoachToolsIntelligence||!state.appId)return;
    try{ const payload=await root.CoachToolsIntelligence.insightForApp(state.appId,{personId:selectedPersonId()});renderSignal(payload); }catch(error){ console.warn('CoachTools intelligence signal unavailable:',error);renderSignal(null); }
  }
  function scheduleRefresh(delay){ clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(refresh,delay==null?120:delay); }

  function loadCoachingGapsLayout(){
    if(state.appId!=='coaching-gaps'||!sharedBase||document.getElementById('coaching-gaps-layout-script'))return;
    const script=document.createElement('script');
    script.id='coaching-gaps-layout-script';
    script.src=new URL('coaching-gaps-layout.js',sharedBase).href;
    script.async=true;
    script.onerror=()=>{ try{console.warn('Coaching Gaps layout patch unavailable.');}catch(_){} };
    document.head.appendChild(script);
  }

  function mount(appId){
    if(state.mounted)return; state.mounted=true;state.appId=appId||root.CoachToolsShell&&root.CoachToolsShell.app&&root.CoachToolsShell.app.id||''; if(!state.appId)return;
    loadCoachingGapsLayout();
    ensureUi();
    if(state.appId==='people-profiles'){
      document.addEventListener('click',event=>{ const target=event.target&&event.target.closest&&event.target.closest('[data-person-id]'); if(!target)return;state.personId=target.dataset.personId||'';scheduleRefresh(220); },true);
      const observer=new MutationObserver(()=>{const id=selectedPersonId();if(id&&id!==state.personId){state.personId=id;scheduleRefresh(180);}}); observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class','aria-selected']});
    }
    root.addEventListener('coachtools:data-updated',()=>scheduleRefresh(300)); root.addEventListener('coachtools:scope-updated',()=>scheduleRefresh(300));
    if(typeof root.requestIdleCallback==='function')root.requestIdleCallback(()=>scheduleRefresh(0),{timeout:1600});else setTimeout(()=>scheduleRefresh(0),700);
  }

  root.CoachToolsInsightUI=Object.freeze({VERSION,mount,refresh,openDrawer,closeDrawer});
})(typeof window!=='undefined'?window:globalThis);