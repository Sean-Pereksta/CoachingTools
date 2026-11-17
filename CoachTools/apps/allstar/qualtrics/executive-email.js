/* Compact, self-contained executive coaching history email. */
'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.QualtricsExecutiveEmail=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const colors=['#dc5b57','#e49a38','#4b78b5','#3d9a8a','#8667ae','#ce769a','#7c9470','#64748b'];
  const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const count=value=>finite(value)?Math.max(0,Math.round(Number(value))).toLocaleString('en-US'):'N/A';
  const decimal=value=>finite(value)?Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'N/A';
  const percent=value=>finite(value)?(Number(value)*100).toLocaleString('en-US',{maximumFractionDigits:1})+'%':'N/A';
  const concernCount=item=>item.coachingContactCount===null?'N/A':count(item.concernRepCount);
  const small='font-size:11px;color:#64748b;line-height:1.4;';
  const cell='padding:7px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:left;';
  function metric(label,value,detail){
    return '<td style="width:25%;padding:8px;vertical-align:top;"><div style="font-size:11px;color:#475569;">'+esc(label)+'</div><div style="font-size:21px;line-height:1.2;font-weight:700;color:#0f172a;">'+esc(value)+'</div>'+(detail?'<div style="'+small+'">'+esc(detail)+'</div>':'')+'</td>';
  }
  function metricStrip(item){
    return '<table class="executive-metrics" role="presentation" style="width:100%;border-collapse:collapse;background:#f1f5f9;margin:8px 0;"><tr>'+metric('Concern reps',concernCount(item),'Unique people below the coaching target')+metric('History reps coached',count(item.coachedRepCount)+' / '+count(item.eligibleRepCount),'At least one topic-matched coaching')+metric('Coachings / week',decimal(item.avgCoachingsPerWeek),'Average across the full selected window')+metric('Coachings / appearance',decimal(item.coachingsPerAppearance),count(item.coachingContactCount)+' contacts · '+count(item.appearanceCount)+' topic appearances')+'</tr></table>';
  }
  function topicLegend(shares){
    return '<table role="presentation" style="width:100%;border-collapse:collapse;">'+shares.map((topic,index)=>'<tr><td style="padding:2px 5px 2px 0;width:10px;vertical-align:top;"><span style="color:'+colors[index%colors.length]+';font-size:13px;">&#9632;</span></td><td style="padding:2px 4px 2px 0;font-size:11px;line-height:1.35;">'+esc(topic.topic)+'</td><td style="padding:2px 0;font-size:11px;text-align:right;white-space:nowrap;">'+count(topic.count)+' · '+percent(topic.share)+'</td></tr>').join('')+'</table>';
  }
  function missingTopics(item,options){
    const shares=Array.isArray(item.missingTopicShares)?item.missingTopicShares:[];
    let chart='';
    if(shares.length&&typeof options.chartImage==='function'){
      try{
        const source=options.chartImage(shares,colors.slice());
        // Only accept a local PNG payload. Email exports embed it as an inline image.
        if(typeof source==='string'&&/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(source)) chart='<td style="width:100px;padding:0 9px 0 0;vertical-align:middle;"><img src="'+source+'" width="92" height="92" alt="Missing coaching opportunities by topic" style="display:block;border:0;width:92px;height:92px;"></td>';
      }catch(error){ /* The numeric legend remains complete if drawing is unavailable. */ }
    }
    return '<div style="font-size:12px;font-weight:700;margin-bottom:5px;">Missing coaching opportunities</div>'+(shares.length?'<table role="presentation" style="width:100%;border-collapse:collapse;"><tr>'+chart+'<td style="vertical-align:middle;">'+topicLegend(shares)+'</td></tr></table><div style="'+small+'margin-top:4px;">Share of concern rep-topic pairs. A rep can appear in several topics.'+(item.coachingContactCount===null?' Known concern topics only; other topic coverage is unknown.':'')+'</div>':'<div style="'+small+'">'+(item.coachingContactCount===null?'Matching coaching data unavailable.':'No high-history rep-topic pairs below the coaching target.')+'</div>');
  }
  function coachedTopics(item){
    const shares=Array.isArray(item.coachedTopicShares)?item.coachedTopicShares:[];
    return '<div style="font-size:12px;font-weight:700;margin-bottom:5px;">Topics coached most</div>'+(shares.length?shares.map(topic=>'<div style="font-size:11px;line-height:1.45;margin:3px 0;">'+esc(topic.topic)+' <strong>'+percent(topic.share)+'</strong> <span style="color:#64748b;">('+count(topic.count)+')</span></div>').join('')+'<div style="'+small+'margin-top:4px;">Share of matched coaching-topic records in the high-history cohort. Multi-topic coaching counts once per topic.</div>':'<div style="'+small+'">'+(item.coachingContactCount===null?'Matching coaching data unavailable.':'No matching coaching in this window.')+'</div>');
  }
  function concernPeople(item){
    const people=new Map();
    for(const record of item.records||[]){
      const key=String(record.repKey||record.repName||'');
      if(!people.has(key)) people.set(key,{name:record.repName||record.repKey||'Unnamed representative',records:[]});
      people.get(key).records.push(record);
    }
    if(!people.size) return '<div style="'+small+'margin-top:7px;">'+(item.coachingContactCount===null?'Concern status is unknown until matching coaching data is available.':'No concern reps for this coach.')+'</div>';
    const sorted=Array.from(people.values()).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    return '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;"><thead><tr><th scope="col" style="'+cell+'background:#f8fafc;width:25%;">Concern rep</th><th scope="col" style="'+cell+'background:#f8fafc;">Topic · history appearances / matching coachings</th></tr></thead><tbody>'+sorted.map(person=>'<tr><th scope="row" style="'+cell+'font-weight:600;">'+esc(person.name)+'</th><td style="'+cell+'">'+person.records.map(record=>esc(record.topic||record.ruleTitle||record.ruleId)+' <strong>'+count(record.appearanceCount)+' / '+count(record.coachingCount)+'</strong>').join('<br>')+'</td></tr>').join('')+'</tbody></table>';
  }
  function coachCard(item,index,options,ranked){
    return '<table role="presentation" id="executive-coach-'+(index+1)+'" style="width:100%;border-collapse:separate;border-spacing:0;margin:14px 0;border:1px solid #cbd5e1;border-radius:8px;background:#fff;"><tr><td style="padding:11px 12px;"><a name="executive-coach-'+(index+1)+'"></a><table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td><h2 style="font-size:17px;line-height:1.2;margin:0;color:#0f172a;">'+(ranked?'#'+(index+1)+' ':'')+esc(item.coach||'Unassigned')+'</h2></td><td style="text-align:right;font-size:12px;font-weight:700;color:#9f332f;">'+(item.coachingContactCount===null?'Concern reps: N/A':concernCount(item)+' concern reps')+'</td></tr></table>'+metricStrip(item)+'<table class="executive-topic-columns" role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="width:55%;vertical-align:top;padding:3px 12px 3px 0;">'+missingTopics(item,options)+'</td><td style="width:45%;vertical-align:top;padding:3px 0 3px 12px;border-left:1px solid #e2e8f0;">'+coachedTopics(item)+'</td></tr></table>'+concernPeople(item)+'<div style="text-align:right;margin-top:6px;font-size:10px;"><a href="#executive-contents" style="color:#315b88;">Back to coach index</a></div></td></tr></table>';
  }
  function makeHtml(review,options){
    review=review||{}; options=options||{};
    const settings=review.settings||{},period=review.window||{},summary=review.summary||{},ranked=review.coachingAvailable!==false&&(review.coaches||[]).every(coach=>coach.coachingContactCount!==null),coaches=(review.coaches||[]).slice().sort((a,b)=>(ranked?(Number(b.concernRepCount)||0)-(Number(a.concernRepCount)||0):0)||String(a.coach||'').localeCompare(String(b.coach||'')));
    const title=options.title||'Executive Coaching History Review';
    const unavailable=review.coachingAvailable===false;
    const warnings=Array.isArray(review.diagnostics?.warnings)?review.diagnostics.warnings:[];
    const warningHtml=warnings.length?'<div style="padding:8px 10px;background:#fffbeb;border:1px solid #fcd34d;margin:10px 0;font-size:11px;color:#78350f;">'+warnings.map(esc).join('<br>')+'</div>':'';
    const scope='<div style="font-size:12px;color:#475569;line-height:1.45;margin:9px 0;">'+esc(period.startDate||'Unknown start')+' – '+esc(period.endDate||options.reportDate||'Unknown end')+' · Last '+count(settings.months)+' month'+(Number(settings.months)===1?'':'s')+'<br><strong>Concern threshold:</strong> More than '+count(settings.minAppearances)+' distinct report appearances on the same topic, with fewer than '+count(settings.minCoachings)+' matching coaching'+(Number(settings.minCoachings)===1?'':'s')+' in this window.</div>';
    const index=coaches.length?'<table id="executive-contents" style="width:100%;border-collapse:collapse;font-size:12px;margin:10px 0 12px;"><caption style="text-align:left;font-weight:700;padding:5px 0;">Coach index · '+(ranked?'ranked by unique concern reps':'alphabetical; coaching coverage is incomplete')+'</caption><thead><tr><th scope="col" style="'+cell+'background:#f1f5f9;width:35px;">'+(ranked?'Rank':'Order')+'</th><th scope="col" style="'+cell+'background:#f1f5f9;">Coach</th><th scope="col" style="'+cell+'background:#f1f5f9;text-align:right;">Concern reps with history</th></tr></thead><tbody>'+coaches.map((coach,i)=>'<tr><td style="'+cell+'">'+(ranked?'#':'')+(i+1)+'</td><td style="'+cell+'"><a href="#executive-coach-'+(i+1)+'" style="font-weight:600;color:#315b88;">'+esc(coach.coach||'Unassigned')+'</a></td><td style="'+cell+'text-align:right;font-weight:700;">'+concernCount(coach)+'</td></tr>').join('')+'</tbody></table>':'';
    const empty=unavailable?'<p style="font-size:13px;color:#78350f;">Load documented coaching data to determine which history reps are below the coaching target. Missing coaching data is shown as N/A.</p>':!coaches.length?'<p style="font-size:13px;color:#475569;">No representatives have enough dated topic history for these thresholds. Load detailed history containing report dates and topic/rule IDs, or adjust the history threshold.</p>':summary.coachingContactCount===null?'<p style="font-size:13px;color:#78350f;">Coaching coverage is unknown for one or more history topics. Concern totals and coach ranking cannot be established.</p>':!Number(summary.concernRepCount)?'<p style="font-size:13px;color:#166534;">No high-history representatives are below the matching coaching target in this window.</p>':'';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>@media(max-width:600px){.executive-shell{padding:10px!important}.executive-shell h1{font-size:22px!important}.executive-metrics>tbody>tr,.executive-metrics>tr{display:block!important}.executive-metrics>tbody>tr>td,.executive-metrics>tr>td{display:inline-block!important;width:50%!important;box-sizing:border-box!important}.executive-topic-columns>tbody>tr,.executive-topic-columns>tr{display:block!important}.executive-topic-columns>tbody>tr>td,.executive-topic-columns>tr>td{display:block!important;width:100%!important;box-sizing:border-box!important;padding:5px 0!important;border-left:0!important}}@media print{tr{break-inside:avoid;page-break-inside:avoid}}</style></head><body style="margin:0;padding:12px;background:#eef2f6;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.35;"><table role="presentation" style="width:100%;max-width:900px;border-collapse:collapse;margin:0 auto;background:#fff;"><tr><td class="executive-shell" style="padding:20px;"><h1 style="font-size:25px;line-height:1.15;margin:0 0 5px;color:#0f172a;">'+esc(title)+'</h1><div style="'+small+'">Report date: '+esc(options.reportDate||period.endDate||'')+'</div>'+scope+warningHtml+metricStrip(summary)+'<div style="'+small+'">History cohort = unique reps above the topic appearance threshold. Coaching metrics cover that full cohort, including reps who meet the coaching target. Concern reps are the subset below target. Appearances count distinct reports per rep and topic; contacts count distinct documented coachings.</div>'+empty+index+coaches.map((coach,i)=>coachCard(coach,i,options,ranked)).join('')+'</td></tr></table></body></html>';
  }
  return {makeHtml,colors:colors.slice()};
});
