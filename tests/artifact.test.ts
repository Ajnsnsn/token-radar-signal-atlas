import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {buildDossier} from '../vendor/makefun-board.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
const input=process.env.ATLAS_TEST_INPUT||resolve(root,'../kit/token-radar-01-kit/input/snapshot.json');
const output=resolve(root,'out-check');
function run(){const result=spawnSync(process.execPath,['main.ts','--input',input,'--output',output],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr)}

test('entry reproduces exact output bytes and all source fits in the official dossier',()=>{
  run();const first=readFileSync(join(output,'dossier.json'));
  run();assert.deepEqual(first,readFileSync(join(output,'dossier.json')));
  assert.deepEqual(first,Buffer.from(buildDossier(output,{text_max_bytes:65536})));
  const dossier=JSON.parse(first.toString('utf8'));
  assert.ok(first.length<=1572864);
  assert.ok(!dossier.text.includes('left out')&&!dossier.text.includes('not shown'));
  assert.equal(dossier.images.length,3);
  let sourceBytes=0;
  for(const name of readdirSync(join(output,'dashboard'))){
    assert.match(name,/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/);
    const path=join(output,'dashboard',name);assert.ok(statSync(path).isFile());
    const text=readFileSync(path,'utf8');sourceBytes+=Buffer.byteLength(text);
    if(name.endsWith('.css'))assert.doesNotMatch(text,/https?:\/\//);
    if(name.endsWith('.html'))assert.doesNotMatch(text,/\b(?:src|href)\s*=\s*["']https?:/i);
    if(name.endsWith('.js'))assert.doesNotMatch(text,/(?:import|from|require)\s*\(?\s*["']https?:/);
  }
  assert.ok(sourceBytes<65536);
});

test('compact dashboard values match the board and screenshots satisfy byte/dimension caps',()=>{
  const board=JSON.parse(readFileSync(join(output,'board.json'),'utf8')).rows;
  const context:any={window:{}};runInNewContext(readFileSync(join(output,'dashboard/data.js'),'utf8'),context);
  const d=context.window.ATLAS;assert.equal(d.rows.length,board.length);
  for(const [i,r] of board.entries()){
    const a=d.rows[i];assert.equal(a[0],r.slug);assert.equal(a[1],r.name);
    assert.equal(a[7],r.implied_value_usd);assert.equal(a[8],r.scenario_low_usd);assert.equal(a[9],r.scenario_high_usd);assert.equal(d.categories[a[2]],r.category);
  }
  for(const image of readdirSync(join(root,'screenshots'))){
    const bytes=readFileSync(join(root,'screenshots',image));assert.ok(bytes.length<=524288);
    assert.equal(bytes.readUInt16BE(0),0xffd8);assert.equal(bytes.readUInt16BE(bytes.length-2),0xffd9);
    let offset=2,dimensions;
    while(offset<bytes.length){const marker=bytes[offset+1],length=bytes.readUInt16BE(offset+2);if([0xc0,0xc1,0xc2].includes(marker)){dimensions=[bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+7)];break}offset+=length+2}
    assert.ok(dimensions);assert.ok(Math.max(...dimensions)<=1440&&Math.min(...dimensions)>=800);
  }
});
