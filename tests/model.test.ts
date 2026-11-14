import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ageDays,ageFactor,boardIssue,buildAtlas,calibrate,excludedProduct,growthFactor,hasToken,PARAMETERS,parseSnapshot,quantile} from '../lib/model.ts';
const input=process.env.ATLAS_TEST_INPUT || fileURLToPath(new URL('../../kit/token-radar-01-kit/input/snapshot.json',import.meta.url));
const snapshot=parseSnapshot(readFileSync(input,'utf8'));
const atlas=buildAtlas(snapshot);

test('sealed snapshot board covers every watchlist slug with real unique ranks',()=>{
  assert.equal(atlas.board.length,140);assert.equal(boardIssue(atlas.board,snapshot),null);
  assert.equal(atlas.data.rows.filter(r=>r.watch).length,snapshot.watchlist.length);
  for(const r of atlas.data.rows){assert.ok(r.low<=r.value&&r.value<=r.high);assert.ok(r.low>0);assert.equal(hasToken(snapshot.protocols.find(p=>p.slug===r.slug)!),false);if(!r.watch)assert.ok(r.tvl<snapshot.floor_usd);}
  const original=new Map(snapshot.protocols.map(p=>[p.slug,p]));
  for(const r of atlas.data.rows.filter(r=>!r.watch))assert.equal(excludedProduct(original.get(r.slug)!),false);
});

test('calibration is empirical, bounded and shrinks thin categories',()=>{
  const c=calibrate(snapshot);assert.equal(c.peers.length,atlas.data.model.peerCount);assert.ok(c.peers.length>50);
  const raw=c.peers.map(p=>Math.log(p.mcap/p.tvl));
  assert.ok(Math.abs(Math.log(c.globalRatio)-quantile(raw,0.5))<1e-12);
  for(const group of c.categories){assert.equal(group.weight,Number((group.n/(group.n+PARAMETERS.priorWeight)).toFixed(6)));assert.ok(group.ratio>=c.lowRatio&&group.ratio<=c.highRatio);}
  assert.ok(!c.peers.some(p=>p.slug==='autofinance'),'negative market-cap sentinel is not a valuation peer');
});

test('ranking never depends on protocol display names',()=>{
  const renamed=structuredClone(snapshot);
  for(const p of renamed.protocols)if(!excludedProduct(p))p.name='Renamed '+p.slug.replace(/-/g,'_');
  const other=buildAtlas(renamed);
  assert.deepEqual(other.board.map(r=>[r.slug,r.rank,r.implied_value_usd]),atlas.board.map(r=>[r.slug,r.rank,r.implied_value_usd]));
});

test('growth is bounded, missing growth neutral, listing age explicit',()=>{
  assert.equal(growthFactor(null),1);assert.equal(growthFactor(10000),Math.sqrt(2));assert.equal(growthFactor(-10000),Math.sqrt(0.4));
  assert.equal(ageDays('2026-11-14','2026-11-15'),0);assert.equal(ageDays('2026-11-14',null),null);assert.equal(ageDays('2026-11-14','n/a'),null);
  assert.equal(ageFactor(null,365),ageFactor(365,0));assert.equal(ageFactor(100000,0),1);assert.equal(ageFactor(0,0),0.75);
  const missing=atlas.data.rows.filter(r=>r.age===null);assert.ok(missing.length>0);for(const r of missing)assert.equal(r.confidence,'limited');
});

test('higher growth affects a candidate monotonically without changing peer calibration',()=>{
  const target=atlas.data.rows.find(r=>r.watch&&r.growth!==null&&r.growth<90)!;
  const changed=structuredClone(snapshot);changed.protocols.find(p=>p.slug===target.slug)!.change_7d=90;
  const a=buildAtlas(changed);assert.ok(a.data.rows.find(r=>r.slug===target.slug)!.value>target.value);assert.equal(a.data.model.globalRatio,atlas.data.model.globalRatio);
});

test('all browser and output farm plans are identical, bounded and category-adapted',()=>{
  const plans=(globalThis as any).AtlasPlans;
  assert.ok(new Set(atlas.data.rows.map(r=>r.planType)).size>=16);
  for(const r of atlas.data.rows){const p=plans.farmPlan(r);const steps=p.steps.map((s:any)=>`${s.title}: ${s.text} Cost: ${s.cost}. Time: ${s.time}.`);assert.deepEqual(steps,atlas.board[r.rank-1].farm_steps);assert.ok(steps.every((s:string)=>s.length>=20&&s.length<=600));assert.ok(p.capital<=50);}
  assert.equal(plans.farmPlan({name:'Example',category:'Derivatives',chains:['Ethereum'],tvl:1e9,age:365}).capital,0);
  assert.match(plans.farmPlan({name:'Example',category:'RWA',chains:['Ethereum'],tvl:1e9,age:365}).steps[1].text,/KYC/);
});

test('runs reproduce exactly and data integrity failures are detected',()=>{
  assert.equal(JSON.stringify(buildAtlas(snapshot)),JSON.stringify(atlas));
  const duplicate=structuredClone(snapshot);duplicate.protocols.push(duplicate.protocols[0]);assert.throws(()=>parseSnapshot(JSON.stringify(duplicate)),/Invalid protocol/);
  const broken=structuredClone(atlas.board);broken[1].rank=1;assert.equal(boardIssue(broken,snapshot),'Ranks are not contiguous');
});
