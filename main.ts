import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, checksumOf, dataScript, parseSnapshot, SnapshotError } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}
function fail(message: string): never {
  process.stderr.write(`yieldradar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  fail(err instanceof SnapshotError ? err.message : `the snapshot at ${inputFile} cannot be read`);
}
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);
if (checksumOf(board) !== radar.checksum) fail('checksum mismatch between board and data');

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board, model_version: radar.model_version, as_of: radar.as_of })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3 — board, detail view, filtered view`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const v = radar.validation, wf = v.walk_forward, rh = v.range_honesty, ac = radar.accounting;
process.stdout.write(
  `yieldradar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlisted, ${board.length} rows scored (${radar.early_size} early below the floor)\n` +
  `yieldradar: fit — blended ${v.blended_multiple}x over ${v.peers_tested} peers; LOO MAE ${Math.round(v.loo.median_absolute_error * 100)}%, ${Math.round(v.loo.within_half * 100)}% within 2x, r=${v.loo.correlation.toFixed(2)}\n` +
  `yieldradar: bands ${Math.round(rh.within_half * 100)}/${Math.round(rh.within_third * 100)}/${Math.round(rh.within_quarter * 100)}% within 2x/3x/4x` +
  (wf ? `; walk-forward ${wf.older_train}→${wf.newer_test} MAE ${Math.round(wf.median_absolute_error * 100)}%` : '') + `\n` +
  `yieldradar: accounting — ${ac.buckets.map((b) => `${b.label} ${b.count}`).join(', ')}; sum ${ac.buckets.reduce((s, b) => s + b.count, 0)}\n` +
  `yieldradar: checksum ${radar.checksum}; top row ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')} implied\n` +
  `yieldradar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json under ${out}\n`,
);

