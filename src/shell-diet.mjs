#!/usr/bin/env node
/**
 * TokenScalpel Shell-Diet (`src/shell-diet.mjs`) — 0 external dependencies
 * CCR "Save & Point" + Normalized Delta Mode for long terminal outputs.
 *
 * Usage:
 *   node src/shell-diet.mjs [--max N] [--raw] [--dsl] -- <command>
 *   node src/shell-diet.mjs --dsl -- npm test
 *
 * Cache: .tokenscalpel_cache/ (auto-cleaned after 2 days).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ANSI_RX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const ISO_TS_RX = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const TIME_HMS_RX = /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;
const UUID_RX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const DUR_RX = /\b\d+(?:\.\d+)?\s*(?:ms|s)\b/g;

export function stripAnsi(line) {
  return String(line ?? '').replace(ANSI_RX, '');
}

/**
 * Normalize volatile terminal tokens (ANSI, timestamps, UUIDs, durations)
 * before Delta Mode comparison against previous run.
 */
export function normalizeForDelta(line) {
  return stripAnsi(line)
    .replace(ISO_TS_RX, '<TS>')
    .replace(TIME_HMS_RX, '<TS>')
    .replace(UUID_RX, '<UUID>')
    .replace(DUR_RX, '<DUR>');
}

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  const flagSlice = sep >= 0 ? argv.slice(0, sep) : argv;
  const cmdTokens = sep >= 0 ? argv.slice(sep + 1) : [];

  let max = 120;
  let raw = false;
  let dsl = false;

  for (let i = 0; i < flagSlice.length; i++) {
    const a = flagSlice[i];
    if (a === '--raw') raw = true;
    else if (a === '--dsl') dsl = true;
    else if (a === '--max' && flagSlice[i + 1]) {
      const parsed = parseInt(flagSlice[++i], 10);
      if (!Number.isNaN(parsed) && parsed > 0) max = parsed;
    } else if (sep < 0 && !a.startsWith('--')) {
      cmdTokens.push(a);
    }
  }

  return { max, raw, dsl, cmd: cmdTokens.join(' ').trim() };
}

export function runShellDiet(argv = process.argv.slice(2), cwd = process.cwd()) {
  const { max: MAX, raw: RAW, dsl: DSL, cmd } = parseArgs(argv);

  if (!cmd) {
    console.log('Usage: node src/shell-diet.mjs [--max N] [--raw] [--dsl] -- <command>');
    return 0;
  }

  const r = spawnSync(
    process.platform === 'win32' ? 'powershell.exe' : 'sh',
    process.platform === 'win32' ? ['-NoProfile', '-Command', cmd] : ['-c', cmd],
    { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );

  const texto = `${r.stdout || ''}${r.stderr ? (r.stdout ? '\n' : '') + r.stderr : ''}`
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '');
  const ls = texto ? texto.split('\n') : [];
  const exitCode = r.status ?? 0;

  if (RAW || ls.length <= MAX) {
    if (texto) console.log(DSL ? stripAnsi(texto) : texto);
    return exitCode;
  }

  const CACHE = path.join(cwd, '.tokenscalpel_cache');
  fs.mkdirSync(CACHE, { recursive: true });
  try {
    for (const f of fs.readdirSync(CACHE)) {
      const p = path.join(CACHE, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 2 * 864e5) fs.rmSync(p, { force: true });
    }
  } catch { /* ignore */ }

  const huella = crypto.createHash('sha1').update(`${cmd}|${cwd}`).digest('hex').slice(0, 8);
  const archivo = path.join(CACHE, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${huella}.log`);
  const previo = path.join(CACHE, `_prev_${huella}.log`);
  fs.writeFileSync(archivo, texto, 'utf8');

  const rel = path.relative(cwd, archivo).replace(/\\/g, '/');
  const kb = (texto.length / 1024).toFixed(1);

  const printNormalSummary = () => {
    const HEAD = 12;
    const TAIL = 10;
    const critRx = /\b(error|errores|failed|fail|fatal|exception|warn(ing)?|✖|✗|❌|cannot|denied|not found|no se encuentra)\b/i;
    const crit = ls
      .map((l, i) => ({ l: stripAnsi(l), n: i + 1 }))
      .filter((x) => x.n > HEAD && x.n <= ls.length - TAIL && critRx.test(x.l));
    const tailIni = Math.max(HEAD, ls.length - TAIL);

    if (DSL) {
      console.log(`HEAD:${ls.slice(0, 5).map((l, i) => `L${i + 1}:${stripAnsi(l).slice(0, 120)}`).join(' || ')}`);
      if (crit.length) {
        console.log(`CRIT:${crit.length}|${crit.slice(0, 10).map((x) => `L${x.n}:${x.l.slice(0, 120)}`).join(' || ')}`);
      }
      if (tailIni < ls.length) {
        console.log(`TAIL:${ls.slice(tailIni).map((l, i) => `L${tailIni + i + 1}:${stripAnsi(l).slice(0, 120)}`).join(' || ')}`);
      }
      return;
    }

    console.log(`── Head (${HEAD}) ──`);
    ls.slice(0, HEAD).forEach((l, i) => console.log(`  ${i + 1}: ${stripAnsi(l).slice(0, 200)}`));
    if (crit.length) {
      console.log(`── Errors/Warnings (${Math.min(crit.length, 15)} of ${crit.length}) ──`);
      crit.slice(0, 15).forEach((x) => console.log(`  ${x.n}: ${x.l.slice(0, 200)}`));
    }
    if (tailIni < ls.length) {
      console.log(`── Tail (${ls.length - tailIni}) ──`);
      ls.slice(tailIni).forEach((l, i) => console.log(`  ${tailIni + i + 1}: ${stripAnsi(l).slice(0, 200)}`));
    }
  };

  if (DSL) {
    console.log(`SHELL:SAVED|LINES:${ls.length}|KB:${kb}|EXIT:${exitCode}|LOG:${rel}`);
  } else {
    console.log(`📦 [SHELL-DIET] ${ls.length} lines / ${kb} KB (exit ${exitCode}) -> saved to ${rel}`);
  }

  if (fs.existsSync(previo)) {
    const prevLines = fs.readFileSync(previo, 'utf8').split('\n');
    const antes = new Set(prevLines.map(normalizeForDelta));
    const nuevas = ls
      .map((l, i) => ({ raw: stripAnsi(l), norm: normalizeForDelta(l), n: i + 1 }))
      .filter((x) => x.norm.trim() && !antes.has(x.norm));

    if (DSL) {
      console.log(`DELTA:NEW:${nuevas.length}/${ls.length}|EXIT:${exitCode}|LOG:${rel}`);
      for (const x of nuevas.slice(0, 40)) {
        console.log(`L${x.n}:${x.raw.slice(0, 160)}`);
      }
      if (nuevas.length > 40) console.log(`DELTA:MORE:+${nuevas.length - 40}|LOG:${rel}`);
    } else {
      console.log(`🔁 [DELTA vs previous] ${nuevas.length} new lines of ${ls.length}:`);
      for (const x of nuevas.slice(0, 40)) console.log(`  ${x.n}: ${x.raw.slice(0, 200)}`);
      if (nuevas.length > 40) console.log(`  … (+${nuevas.length - 40} more; slice ${rel})`);
    }
    if (nuevas.length === 0 && exitCode !== 0) printNormalSummary();
  } else {
    printNormalSummary();
  }

  if (!DSL) {
    console.log(`ℹ️ Slice range: node src/outline.mjs ${rel} --slice <start:end>`);
  }
  fs.copyFileSync(archivo, previo);
  return exitCode;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.exit(runShellDiet());
}
