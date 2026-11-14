// Signal Atlas. Dependency-free Node 22.18+; the snapshot is the only input.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAtlas, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
function option(name: string, fallback: string): string {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : process.argv.find(v => v.startsWith('--' + name + '='))?.split('=').slice(1).join('=') ?? fallback;
}
const input = option('input', '/input/snapshot.json');
const inputFile = input.endsWith('.json') ? input : join(input, 'snapshot.json');
const out = resolve(option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));
if (!existsSync(inputFile)) throw new Error('Missing sealed snapshot: use --input <snapshot.json>.');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, data } = buildAtlas(snapshot);

/** Dictionary encoding keeps every row and peer inside the dossier's source budget. */
function compactData(d: any): string {
  const cats = [...new Set([...d.rows, ...d.peers].map(p => p.category ?? 'Unclassified'))];
  const chains = [...new Set(d.rows.flatMap(p => p.chains))];
  const peerIndex = new Map(d.peers.map((p, i) => [p.slug, i]));
  // Deterministic factors and labels are reconstructed in app.js from their inputs.
  const rows = d.rows.map(p => [p.slug, p.name, cats.indexOf(p.category ?? 'Unclassified'), p.chains.map(c => chains.indexOf(c)), p.tvl, p.growth, p.age, p.value, p.low, p.high, +p.watch, p.peerSlugs.map(s => peerIndex.get(s))]);
  const peers = d.peers.map(p => [p.name, cats.indexOf(p.category ?? 'Unclassified'), p.tvl, p.mcap]);
  const model = { parameters: {priorWeight:d.model.parameters.priorWeight}, globalRatio:d.model.globalRatio, peerCount:d.model.peerCount, fallbackAge:d.model.fallbackAge, ratioWinsor:d.model.ratioWinsor, uncertainty:d.model.uncertainty, categories:d.model.categories.map(c => [cats.indexOf(c.category), c.n, c.weight, c.ratio]) };
  return 'window.ATLAS=' + JSON.stringify({ ...d, model, categories: cats, chains, rows, peers }).replace(/</g, '\\u003c') + ';\n';
}
function copyDirectory(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const item of readdirSync(from, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const source = join(from, item.name), dest = join(to, item.name);
    if (item.isDirectory()) copyDirectory(source, dest);
    else if (item.isFile()) copyFileSync(source, dest);
    else throw new Error('Only regular files may be shipped: ' + source);
  }
}
/** Validate the submission contract independently of presentation. */
function validateBoard(): void {
  const known = new Set(snapshot.protocols.map(p => p.slug));
  const slugs = new Set();
  if (board.length < 100 || board.length > 4000) throw new Error('Board row count outside contract.');
  for (const [i, row] of board.entries()) {
    if (!known.has(row.slug) || slugs.has(row.slug)) throw new Error('Unknown or duplicate protocol.');
    slugs.add(row.slug);
    if (row.rank !== i + 1 || !Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) throw new Error('Invalid rank/value.');
    if (i && row.implied_value_usd > board[i - 1].implied_value_usd) throw new Error('Rank order is not monotonic.');
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12 || row.farm_steps.some(s => s.trim().length < 20 || s.trim().length > 600)) throw new Error('Invalid plan for ' + row.slug);
  }
  if (snapshot.watchlist.some(s => !slugs.has(s))) throw new Error('Watchlist coverage missing.');
  if (new Set(board.map(r => r.implied_value_usd)).size < 2) throw new Error('Constant-valued board.');
}
validateBoard();
mkdirSync(out, { recursive: true });
copyDirectory(join(here, 'dashboard'), join(out, 'dashboard'));
writeFileSync(join(out, 'dashboard', 'data.js'), compactData(data));
writeFileSync(join(out, 'board.json'), JSON.stringify({ model: 'Signal Atlas 1', as_of: data.asOf, rows: board }) + '\n');
const preview = process.argv.includes('--preview');
if (!preview) {
  copyDirectory(join(here, 'screenshots'), join(out, 'screenshots'));
  const images = readdirSync(join(out, 'screenshots')).filter(n => !n.startsWith('.'));
  if (images.length < 3 || images.length > 4) throw new Error('Expected 3–4 real dashboard screenshots.');
  const dossier = buildDossier(out, { text_max_bytes: 65536 });
  if (dossier.byteLength > 1572864) throw new Error('Dossier exceeds bounty cap.');
  writeFileSync(join(out, 'dossier.json'), dossier);
}
const bytes = readdirSync(join(out, 'dashboard')).reduce((sum, name) => sum + statSync(join(out, 'dashboard', name)).size, 0);
console.log(JSON.stringify({ rows: board.length, watchlist: snapshot.watchlist.length, dashboardBytes: bytes, output: out, preview }));
