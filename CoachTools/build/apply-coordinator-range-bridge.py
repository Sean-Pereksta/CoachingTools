from pathlib import Path
import re

path = Path('CoachTools/apps/coach-timeline.html')
text = path.read_text(encoding='utf-8')
marker = 'window.CoachTimelineCoordinatorRangesAPI=Object.freeze({'
anchor = '  installCoordinatorTimelinePointerHandlers();\n  installCoordinatorRankingHandlers();'

if marker in text:
    raise SystemExit('Coordinator range bridge already exists; refusing to add it twice.')
if text.count(anchor) != 1:
    raise SystemExit(f'Expected exactly one install anchor, found {text.count(anchor)}.')

bridge = r'''  function coordinatorCustomRangeBands(){
    const bands=Array.isArray(S.coordinatorConfig.rangeBands)?S.coordinatorConfig.rangeBands:[];
    return bands.map(band=>({...band}));
  }
  function coordinatorCustomRangeRows(bands,allRows){
    const result=getCoordinatorRankingRows(),rows=allRows?S.lastCoordinatorRankingRows:result.rows,groups=new Map();
    const pairs=coordinatorRankingAggregate().quality.pairs||[];
    pairs.forEach(pair=>{
      const initial=String(pair.initial||"").trim().toUpperCase(),nameKey=normCoachKey(pair.coordinator),key=nameKey+"|"+initial,list=groups.get(key)||[],value=Number(pair.days);
      if(Number.isFinite(value)&&value>=0)list.push(value);
      groups.set(key,list);
    });
    return rows.map(row=>{
      const nameKey=normCoachKey(row.name),initial=String(row.initial||"").trim().toUpperCase(),values=groups.get(nameKey+"|"+initial)||groups.get(nameKey+"|")||[];
      const metrics=(bands||[]).map(band=>{
        let min=Number(band.min),max=Number(band.max);
        if(!Number.isFinite(min)||!Number.isFinite(max)||!values.length)return{id:band.id,count:0,total:values.length,pct:NaN};
        min=Math.max(0,min);max=Math.max(0,max);if(min>max)[min,max]=[max,min];
        const count=values.filter(value=>value>=min&&value<=max).length;
        return{id:band.id,count,total:values.length,pct:count/values.length*100};
      });
      return{row,metrics};
    });
  }
  window.CoachTimelineCoordinatorRangesAPI=Object.freeze({
    getRangeBands:()=>coordinatorCustomRangeBands(),
    setRangeBands:bands=>{
      S.coordinatorConfig.rangeBands=Array.isArray(bands)?bands.map((band,index)=>({
        id:String(band&&band.id||`coord_range_${Date.now()}_${index+1}`),
        label:String(band&&band.label||`Custom range ${index+1}`),
        min:Math.max(0,Number(band&&band.min)||0),
        max:Math.max(0,Number(band&&band.max)||0)
      })):[];
      saveCoordinatorConfig();
    },
    getRangeRows:(bands,allRows)=>coordinatorCustomRangeRows(bands,!!allRows),
    getConfig:()=>({
      ...S.coordinatorConfig,
      early:{...S.coordinatorConfig.early},
      late:{...S.coordinatorConfig.late},
      visibleColumns:[...(S.coordinatorConfig.visibleColumns||[])]
    }),
    getColumnDefs:()=>COORD_RANK_COLUMN_DEFS.map(column=>({...column})),
    formatDate:value=>fmtDate(value),
    getTimeframeLabel:()=>getTimeframe().label,
    render:()=>renderCoordinatorSpeedRankings(),
    toast:(title,detail)=>toast(title,detail)
  });

'''

path.write_text(text.replace(anchor, bridge + anchor), encoding='utf-8')

updated = path.read_text(encoding='utf-8')
scripts = re.findall(r'<script(?:[^>]*)>(.*?)</script>', updated, flags=re.S)
inline = next((script for script in scripts if '(async function(){' in script), None)
if inline is None:
    raise SystemExit('Could not locate Coach Timeline inline application script.')
Path('/tmp/coach-timeline-inline.js').write_text(inline, encoding='utf-8')
