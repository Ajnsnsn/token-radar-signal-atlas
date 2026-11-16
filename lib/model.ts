import '../dashboard/plans.js';
import '../dashboard/math.js';

export type Protocol = { slug:string; name:string; category:string|null; chains:string[]; tvl_usd:number; change_7d:number|null; mcap_usd:number|null; listed_at:string|null; gecko_id:string|null; symbol:string|null };
export type Snapshot = { as_of:string; source:string; floor_usd:number; protocols:Protocol[]; watchlist:string[] };
type Step = {title:string;text:string;cost:string;time:string};
const plans = (globalThis as unknown as {AtlasPlans:{planType:(c:string|null)=>string;farmPlan:(r:Record<string,unknown>)=>{steps:Step[]}}}).AtlasPlans;
const math=(globalThis as any).AtlasMath;
export const PARAMETERS = math.parameters;
const blocked = new Set(['Bridge','Canonical Bridge','Cross Chain Bridge','Liquid Staking','Liquid Restaking','Restaked BTC','CEX','Stablecoin Wrapper','Anchor BTC','Decentralized BTC']);
const versions = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const round = (v:number,n=6) => Number(v.toFixed(n));
export const {clamp,quantile,growthFactor,ageFactor,estimate,auditPeers}=math;
export function ageDays(asOf:string,date:string|null):number|null { if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null; const a=Date.parse(asOf+'T00:00:00Z'),b=Date.parse(date+'T00:00:00Z'); return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.floor((a-b)/86400000)):null; }
export function hasToken(p:Protocol):boolean { return p.gecko_id!==null || p.symbol!==null || p.mcap_usd!==null; }
export function excludedProduct(p:Protocol):boolean { return blocked.has(p.category||'') || versions.test(p.name) || /\b(wrapped|staked|staking)\b/i.test(p.name) || /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name); }
export function eligible(p:Protocol,s:Snapshot):boolean { return !hasToken(p) && !excludedProduct(p) && p.tvl_usd<s.floor_usd; }
export const tokenKey=(p:Protocol)=>p.gecko_id || p.symbol?.toUpperCase() || p.slug;

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
    const key=tokenKey(p), previous=tokens.get(key);
    if (!previous || p.tvl_usd>previous.tvl_usd || (p.tvl_usd===previous.tvl_usd && p.slug<previous.slug)) tokens.set(key,p);
  }
  const peers=[...tokens.values()].sort((a,b)=>a.slug.localeCompare(b.slug)).map(p=>({slug:p.slug,name:p.name,category:p.category||'Unclassified',tvl:p.tvl_usd,mcap:p.mcap_usd!,ratio:p.mcap_usd!/p.tvl_usd,tokenKey:tokenKey(p),growth:p.change_7d,age:ageDays(s.as_of,p.listed_at),duplicateCount:s.protocols.filter(q=>hasToken(q)&&tokenKey(q)===tokenKey(p)).length}));
  return math.calibratePeers(peers,[...new Set(s.protocols.map(p=>p.category||'Unclassified'))].sort());
}

export function buildAtlas(s:Snapshot) {
  const calibration=calibrate(s), watch=new Set(s.watchlist);
  const pool=s.protocols.filter(p=>watch.has(p.slug)||eligible(p,s));
  if (pool.some(p=>watch.has(p.slug)&&hasToken(p))) throw new Error('Watchlist token metadata conflict; do not silently label an observed token as unrecorded');
  const knownAges=pool.map(p=>ageDays(s.as_of,p.listed_at)).filter((a):a is number=>a!==null),fallbackAge=knownAges.length?Math.round(quantile(knownAges,0.5)):0;
  const stats=new Map(calibration.categories.map(c=>[c.category,c]));
  const scored=pool.map(p=>{
    const category=p.category||'Unclassified',c=stats.get(category)!,age=ageDays(s.as_of,p.listed_at);
    const prediction=estimate({tvl:p.tvl_usd,growth:p.change_7d,age},c,fallbackAge);
    const evidence=math.nearestPeers({category,tvl:p.tvl_usd},calibration.peers);
    const confidence=c.n>=6&&age!==null&&p.change_7d!==null?'stronger':c.n>=3&&age!==null?'moderate':'limited';
    return {slug:p.slug,name:p.name,category,chains:p.chains,tvl:p.tvl_usd,growth:p.change_7d,listedAt:p.listed_at,age,...prediction,watch:watch.has(p.slug),ratio:round(c.ratio),lowRatio:c.lowRatio,highRatio:c.highRatio,confidence,peerN:c.n,peerSlugs:evidence,planType:plans.planType(p.category),rank:0};
  });
  const order=(a:typeof scored[number],b:typeof scored[number])=>b.value-a.value||a.slug.localeCompare(b.slug);
  const chosen=[...scored.filter(r=>r.watch),...scored.filter(r=>!r.watch).sort(order).slice(0,Math.max(0,PARAMETERS.maxRows-watch.size))].sort(order);
  const rows=chosen.map((r,i)=>({...r,rank:i+1}));
  const board=rows.map(r=>({rank:r.rank,slug:r.slug,name:r.name,category:r.category,chains:r.chains,tvl_usd:r.tvl,change_7d:r.growth,listed_at:r.listedAt,token_status:'no-token-recorded',implied_value_usd:r.value,scenario_low_usd:r.low,scenario_high_usd:r.high,watchlist:r.watch,model:{peer_multiple:r.ratio,peer_count:r.peerN,peer_examples:r.peerSlugs,growth_multiplier:round(r.growthMult),listing_age_days:r.age,age_multiplier:round(r.ageMult),scenario_low_ratio:r.lowRatio,scenario_high_ratio:r.highRatio,scenario_expansion:r.expansion,evidence:r.confidence},farm_steps:plans.farmPlan(r).steps.map(step=>`${step.title}: ${step.text} Cost: ${step.cost}. Time: ${step.time}.`)}));
  const issue=boardIssue(board,s);if(issue)throw new Error(issue);
  const peers=calibration.peers,audit=auditPeers(peers,fallbackAge);
  const data={asOf:s.as_of,source:s.source,floor:s.floor_usd,total:s.protocols.length,watchlistSize:watch.size,eligibleSize:pool.length,rows,peers,audit,model:{version:'atlas-2',formula:'TVL × shrunk peer MCap/TVL × √(1 + clipped 7d growth / 100) × listing-age factor',parameters:PARAMETERS,globalRatio:round(calibration.globalRatio),peerCount:calibration.peers.length,peerExamples:peers.length,fallbackAge,ratioWinsor:[round(calibration.lowRatio),round(calibration.highRatio)],categories:calibration.categories.filter(c=>rows.some(r=>r.category===c.category)).map(c=>({...c,ratio:round(c.ratio),lowRatio:round(c.lowRatio),highRatio:round(c.highRatio)})),interpretation:'Conditional market-cap analogue in USD; not FDV, token price, launch probability or airdrop return. Market cap and TVL need not accrue to tokenholders.',ageCaveat:'Age is days since DefiLlama first tracked the protocol, not protocol age or proof it has run without a token.',uncertainty:'Scenario band blends category/global 20th–80th peer ratios and widens for sparse peers or missing data; it is not a confidence interval.'},excluded:{recordedToken:s.protocols.filter(hasToken).length,product:s.protocols.filter(p=>!hasToken(p)&&excludedProduct(p)&&!watch.has(p.slug)).length,notSelected:pool.length-rows.length,policy:'All official watchlist rows plus highest modeled below-floor candidates. Derivative products and versioned pools are excluded from discovery; parent metadata is unavailable for extras. Watchlist overrides remain included.'}};
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
