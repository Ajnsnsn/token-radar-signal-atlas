import '../dashboard/plans.js';

export type Protocol = { slug:string; name:string; category:string|null; chains:string[]; tvl_usd:number; change_7d:number|null; mcap_usd:number|null; listed_at:string|null; gecko_id:string|null; symbol:string|null };
export type Snapshot = { as_of:string; source:string; floor_usd:number; protocols:Protocol[]; watchlist:string[] };
type Step = {title:string;text:string;cost:string;time:string};
const plans = (globalThis as unknown as {AtlasPlans:{planType:(c:string|null)=>string;farmPlan:(r:Record<string,unknown>)=>{steps:Step[]}}}).AtlasPlans;
export const PARAMETERS = Object.freeze({ maxRows:140, priorWeight:6, growthFloor:-60, growthCap:100, growthExponent:0.5, ageFloor:0.75, ageRange:0.25, ageCapDays:730, ratioWinsorLow:0.1, ratioWinsorHigh:0.9 });
const blocked = new Set(['Bridge','Canonical Bridge','Cross Chain Bridge','Liquid Staking','Liquid Restaking','Restaked BTC','CEX','Stablecoin Wrapper','Anchor BTC','Decentralized BTC']);
const versions = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const round = (v:number,n=6) => Number(v.toFixed(n));
export const clamp = (v:number,lo:number,hi:number) => Math.min(hi,Math.max(lo,v));
export function quantile(values:number[],q:number):number { if (!values.length) throw new Error('Cannot calibrate an empty peer set'); const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,i=Math.floor(p); return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(p-i); }
export function ageDays(asOf:string,date:string|null):number|null { if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null; const a=Date.parse(asOf+'T00:00:00Z'),b=Date.parse(date+'T00:00:00Z'); return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.floor((a-b)/86400000)):null; }
export function hasToken(p:Protocol):boolean { return p.gecko_id!==null || p.symbol!==null || p.mcap_usd!==null; }
export function excludedProduct(p:Protocol):boolean { return blocked.has(p.category||'') || versions.test(p.name) || /\b(wrapped|staked|staking)\b/i.test(p.name) || /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name); }
export function eligible(p:Protocol,s:Snapshot):boolean { return !hasToken(p) && !excludedProduct(p) && p.tvl_usd<s.floor_usd; }
export function growthFactor(growth:number|null):number { return Math.pow(1+clamp(growth??0,PARAMETERS.growthFloor,PARAMETERS.growthCap)/100,PARAMETERS.growthExponent); }
export function ageFactor(age:number|null,fallback:number):number { return PARAMETERS.ageFloor+PARAMETERS.ageRange*clamp(age??fallback,0,PARAMETERS.ageCapDays)/PARAMETERS.ageCapDays; }

export function parseSnapshot(text:string):Snapshot {
  const s=JSON.parse(text);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.as_of) || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist) || !(s.floor_usd>0)) throw new Error('Invalid snapshot metadata');
  const slugs=new Set<string>();
  for (const p of s.protocols) {
    if (!p || typeof p.slug!=='string' || !p.slug || /\s/.test(p.slug) || slugs.has(p.slug) || typeof p.name!=='string' || !p.name.trim() || !Number.isSafeInteger(p.tvl_usd) || p.tvl_usd<=0 || !Array.isArray(p.chains)) throw new Error('Invalid protocol record');
    if (p.change_7d!==null && !Number.isFinite(p.change_7d)) throw new Error('Invalid growth');
    // The sealed source contains a -1 market-cap sentinel. Keep its token
    // indicator, but calibration below admits strictly positive caps only.
    if (p.mcap_usd!==null && !Number.isFinite(p.mcap_usd)) throw new Error('Invalid market cap');
    slugs.add(p.slug);
  }
  if (new Set(s.watchlist).size!==s.watchlist.length || s.watchlist.some((v:string)=>!slugs.has(v))) throw new Error('Invalid watchlist');
  return s;
}

export function calibrate(s:Snapshot) {
  // A market cap may be repeated across products. One largest-TVL record per token
  // prevents that token from being counted several times. Names never set values.
  const tokens=new Map<string,Protocol>();
  for (const p of s.protocols) {
    if (!hasToken(p) || !(p.mcap_usd!>0) || excludedProduct(p) || p.category==='Chain') continue;
    const key=p.gecko_id || p.symbol?.toUpperCase() || p.slug, previous=tokens.get(key);
    if (!previous || p.tvl_usd>previous.tvl_usd || (p.tvl_usd===previous.tvl_usd && p.slug<previous.slug)) tokens.set(key,p);
  }
  const peers=[...tokens.values()].sort((a,b)=>a.slug.localeCompare(b.slug)).map(p=>({slug:p.slug,name:p.name,category:p.category||'Unclassified',tvl:p.tvl_usd,mcap:p.mcap_usd!,ratio:p.mcap_usd!/p.tvl_usd}));
  if (peers.length<3) throw new Error('At least three observed-token valuation peers are required');
  const raw=peers.map(p=>Math.log(p.ratio)),lo=quantile(raw,0.1),hi=quantile(raw,0.9);
  const logs=raw.map(v=>clamp(v,lo,hi)),median=quantile(logs,0.5),q20=quantile(logs,0.2),q80=quantile(logs,0.8);
  const categories=[...new Set(s.protocols.map(p=>p.category||'Unclassified'))].sort().map(category=>{
    const group=peers.filter(p=>p.category===category),g=group.map(p=>clamp(Math.log(p.ratio),lo,hi)),weight=g.length/(g.length+PARAMETERS.priorWeight);
    const blend=(q:number,f:number)=>weight*(g.length?quantile(g,q):f)+(1-weight)*f;
    return {category,n:g.length,weight:round(weight),ratio:Math.exp(blend(0.5,median)),lowRatio:Math.exp(blend(0.2,q20)),highRatio:Math.exp(blend(0.8,q80))};
  });
  return {peers,categories,globalRatio:Math.exp(median),lowRatio:Math.exp(lo),highRatio:Math.exp(hi)};
}

export function buildAtlas(s:Snapshot) {
  const calibration=calibrate(s), watch=new Set(s.watchlist);
  const pool=s.protocols.filter(p=>watch.has(p.slug)||eligible(p,s));
  if (pool.some(p=>watch.has(p.slug)&&hasToken(p))) throw new Error('Watchlist token metadata conflict; do not silently label an observed token as unrecorded');
  const knownAges=pool.map(p=>ageDays(s.as_of,p.listed_at)).filter((a):a is number=>a!==null),fallbackAge=knownAges.length?Math.round(quantile(knownAges,0.5)):0;
  const stats=new Map(calibration.categories.map(c=>[c.category,c]));
  const scored=pool.map(p=>{
    const category=p.category||'Unclassified',c=stats.get(category)!,age=ageDays(s.as_of,p.listed_at),g=growthFactor(p.change_7d),a=ageFactor(age,fallbackAge);
    const value=Math.max(1,Math.min(100000000000000,Math.round(p.tvl_usd*c.ratio*g*a)));
    // These are scenario bounds, not statistical confidence intervals. Sparse
    // categories and absent metadata widen the empirical peer dispersion.
    const expansion=Math.exp(0.20+0.25*(1-c.weight)+(age===null?0.15:0)+(p.change_7d===null?0.15:0));
    const low=Math.max(1,Math.min(value,Math.round(p.tvl_usd*c.lowRatio*g*a/expansion)));
    const high=Math.max(value,Math.min(100000000000000,Math.round(p.tvl_usd*c.highRatio*g*a*expansion)));
    const similar=calibration.peers.filter(q=>q.category===category);
    const evidence=(similar.length?similar:calibration.peers).slice().sort((x,y)=>Math.abs(Math.log(x.tvl/p.tvl_usd))-Math.abs(Math.log(y.tvl/p.tvl_usd))||x.slug.localeCompare(y.slug)).slice(0,3).map(q=>q.slug);
    const confidence=c.n>=6&&age!==null&&p.change_7d!==null?'stronger':c.n>=3&&age!==null?'moderate':'limited';
    return {slug:p.slug,name:p.name,category,chains:p.chains,tvl:p.tvl_usd,growth:p.change_7d,listedAt:p.listed_at,age,value,low,high,watch:watch.has(p.slug),ratio:round(c.ratio),growthMult:round(g),ageMult:round(a),confidence,peerN:c.n,peerSlugs:evidence,planType:plans.planType(p.category),rank:0};
  });
  const order=(a:typeof scored[number],b:typeof scored[number])=>b.value-a.value||a.slug.localeCompare(b.slug);
  const chosen=[...scored.filter(r=>r.watch),...scored.filter(r=>!r.watch).sort(order).slice(0,Math.max(0,PARAMETERS.maxRows-watch.size))].sort(order);
  const rows=chosen.map((r,i)=>({...r,rank:i+1}));
  const board=rows.map(r=>({rank:r.rank,slug:r.slug,name:r.name,category:r.category,chains:r.chains,tvl_usd:r.tvl,change_7d:r.growth,listed_at:r.listedAt,token_status:'no-token-recorded',implied_value_usd:r.value,scenario_low_usd:r.low,scenario_high_usd:r.high,watchlist:r.watch,model:{peer_multiple:r.ratio,peer_count:r.peerN,peer_examples:r.peerSlugs,growth_multiplier:r.growthMult,listing_age_days:r.age,age_multiplier:r.ageMult,evidence:r.confidence},farm_steps:plans.farmPlan(r).steps.map(step=>`${step.title}: ${step.text} Cost: ${step.cost}. Time: ${step.time}.`)}));
  const issue=boardIssue(board,s);if(issue)throw new Error(issue);
  const evidence=new Set(rows.flatMap(r=>r.peerSlugs));
  const peers=calibration.peers.filter(p=>evidence.has(p.slug)).map(p=>({...p,ratio:round(p.ratio)}));
  const data={asOf:s.as_of,source:s.source,floor:s.floor_usd,total:s.protocols.length,watchlistSize:watch.size,eligibleSize:pool.length,rows,peers,model:{version:'atlas-1',formula:'TVL × shrunk peer MCap/TVL × √(1 + clipped 7d growth / 100) × listing-age factor',parameters:PARAMETERS,globalRatio:round(calibration.globalRatio),peerCount:calibration.peers.length,peerExamples:peers.length,fallbackAge,ratioWinsor:[round(calibration.lowRatio),round(calibration.highRatio)],categories:calibration.categories.filter(c=>rows.some(r=>r.category===c.category)).map(c=>({...c,ratio:round(c.ratio),lowRatio:round(c.lowRatio),highRatio:round(c.highRatio)})),interpretation:'Conditional market-cap analogue in USD; not FDV, token price, launch probability or airdrop return. Market cap and TVL need not accrue to tokenholders.',ageCaveat:'Age is days since DefiLlama first tracked the protocol, not protocol age or proof it has run without a token.',uncertainty:'Scenario band blends category/global 20th–80th peer ratios and widens for sparse peers or missing data; it is not a confidence interval.'},excluded:{recordedToken:s.protocols.filter(hasToken).length,product:s.protocols.filter(p=>!hasToken(p)&&excludedProduct(p)&&!watch.has(p.slug)).length,notSelected:pool.length-rows.length,policy:'All official watchlist rows plus highest modeled below-floor candidates. Derivative products and versioned pools are excluded from discovery; parent metadata is unavailable for extras. Watchlist overrides remain included.'}};
  return {board,data};
}

export function boardIssue(rows:any[],s:Snapshot):string|null {
  if(rows.length<100||rows.length>4000)return 'Board must contain 100–4000 rows';
  const known=new Set(s.protocols.map(p=>p.slug)),seen=new Set<string>();
  for(let i=0;i<rows.length;i++) {const r=rows[i];if(!known.has(r.slug)||seen.has(r.slug))return 'Unknown or duplicate slug';seen.add(r.slug);if(r.rank!==i+1)return 'Ranks are not contiguous';if(!Number.isSafeInteger(r.implied_value_usd)||r.implied_value_usd<1||r.implied_value_usd>100000000000000)return 'Invalid value';if(i&&r.implied_value_usd>rows[i-1].implied_value_usd)return 'Values are not monotone';if(r.farm_steps.length<3||r.farm_steps.length>12||r.farm_steps.some((v:string)=>typeof v!=='string'||v.trim().length<20||v.trim().length>600))return 'Invalid farm steps';}
  if(s.watchlist.some(v=>!seen.has(v)))return 'Missing watchlist row';
  if(rows.every(r=>r.implied_value_usd===rows[0].implied_value_usd))return 'Degenerate ranking';
  return null;
}
