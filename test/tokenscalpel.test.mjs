import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SENSITIVE_DENY_PATTERNS,
  isSensitiveFile,
  outlineFile,
  sliceFile,
  sliceBySymbol,
  gitDiffSymbols,
  findRefs,
} from '../src/outline.mjs';
import { selectPauliSlices } from '../src/pauli-select.mjs';
import { normalizeForDelta, stripAnsi, runShellDiet } from '../src/shell-diet.mjs';
import { measureRepetitionRatio, scoreResponses } from '../src/eval-models.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- P1: Structural Outliner with exact endLine + Sensitive Guard + --slice <symbolName> ---
test('P1: outlineFile computes exact endLine for JS, PY, MD, and HTML', () => {
  const dir = makeTmpDir('ts-p1-');
  try {
    const jsPath = path.join(dir, 'sample.mjs');
    fs.writeFileSync(
      jsPath,
      [
        'export function alpha(opts = {}) {',
        '  const regex = /[{}]/g;',
        '  const msg = `hello ${opts.name || "world"}`;',
        '  return { regex, msg };',
        '}',
        '',
        'const singleArrow = (x) => x * 2;',
        '',
        'export class Engine {',
        '  run() {',
        '    return 42;',
        '  }',
        '}',
      ].join('\n'),
      'utf8'
    );
    const jsOut = outlineFile(jsPath);
    assert.equal(jsOut.entries.length, 3);
    assert.deepEqual(
      jsOut.entries.map((e) => [e.kind, e.line, e.endLine]),
      [
        ['function', 1, 5],
        ['arrow', 7, 7],
        ['class', 9, 13],
      ]
    );

    const pyPath = path.join(dir, 'sample.py');
    fs.writeFileSync(
      pyPath,
      [
        'def greet(name):',
        '    prompt = """Line 1',
        'Line 2 at col zero',
        '"""',
        '    return prompt + name',
        '',
        'class Worker:',
        '    def step(self):',
        '        return 1',
      ].join('\n'),
      'utf8'
    );
    const pyOut = outlineFile(pyPath);
    assert.equal(pyOut.entries[0].line, 1);
    assert.equal(pyOut.entries[0].endLine, 5);
    assert.equal(pyOut.entries[1].line, 7);
    assert.equal(pyOut.entries[1].endLine, 9);

    const mdPath = path.join(dir, 'doc.md');
    fs.writeFileSync(
      mdPath,
      [
        '# Title',
        'Intro line',
        '## Section A',
        'Body A',
        '### Sub A1',
        'Sub body',
        '## Section B',
        'Body B',
      ].join('\n'),
      'utf8'
    );
    const mdOut = outlineFile(mdPath);
    assert.deepEqual(
      mdOut.entries.map((e) => [e.line, e.endLine]),
      [
        [1, 8],
        [3, 6],
        [5, 6],
        [7, 8],
      ]
    );

    const htmlPath = path.join(dir, 'page.html');
    fs.writeFileSync(
      htmlPath,
      [
        '<header>',
        '  <h1>Hi</h1>',
        '</header>',
        '<script>',
        'function boot() {',
        '  return true;',
        '}',
        '</script>',
      ].join('\n'),
      'utf8'
    );
    const htmlOut = outlineFile(htmlPath);
    assert.deepEqual(
      htmlOut.entries.map((e) => [e.line, e.endLine]),
      [
        [1, 3],
        [4, 8],
        [5, 7],
      ]
    );

    // sliceBySymbol + CLI --slice <symbolName>
    const sliced = sliceBySymbol(jsPath, 'Engine');
    assert.equal(sliced.startLine, 9);
    assert.equal(sliced.endLine, 13);

    const cliOut = execFileSync(
      process.execPath,
      [path.join(pkgRoot, 'src/outline.mjs'), jsPath, '--slice', 'alpha'],
      { encoding: 'utf8' }
    );
    assert.match(cliOut, /alpha\.mjs|sample\.mjs L1-L5/);
    assert.match(cliOut, /return \{ regex, msg \}/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P1: sensitive file denylist blocks .env and private keys', () => {
  assert.ok(SENSITIVE_DENY_PATTERNS.length >= 4);
  assert.equal(isSensitiveFile('/tmp/.env'), true);
  assert.equal(isSensitiveFile('/tmp/id_rsa'), true);
  assert.equal(isSensitiveFile('/tmp/app.mjs'), false);

  const dir = makeTmpDir('ts-sec-');
  try {
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'SECRET=123\n', 'utf8');
    assert.throws(() => outlineFile(envFile), /SECURITY_BLOCK/);
    assert.throws(() => sliceFile(envFile, 1, 2), /SECURITY_BLOCK/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- P2: Pauli Exclusion Slice Selector ---
test('P2: selectPauliSlices enforces Pos 1 highest baseScore, redundancy penalty, and file diversity', () => {
  assert.deepEqual(selectPauliSlices([], ['foo']), []);

  const candidates = [
    {
      file: 'a.mjs',
      startLine: 1,
      endLine: 10,
      text: 'function findBridge(graph, a, b) { return privacyFirewall(a, b); }',
      baseScore: 10,
      symbol: 'findBridge',
    },
    {
      file: 'a.mjs',
      startLine: 12,
      endLine: 22,
      text: 'function findBridgeClone(graph, a, b) { return privacyFirewall(a, b); }',
      baseScore: 8,
      symbol: 'findBridge',
    },
    {
      file: 'b.mjs',
      startLine: 1,
      endLine: 12,
      text: 'export function loadNetwork(dir) { return sqliteWalOpen(dir); }',
      baseScore: 7,
      symbol: 'loadNetwork',
    },
  ];

  const picked = selectPauliSlices(candidates, ['findBridge', 'loadNetwork'], {
    maxSlices: 2,
    maxTokens: 1000,
    gamma: 0.7,
    fileDiversityBonus: 0.3,
  });

  assert.equal(picked.length, 2);
  assert.equal(picked[0].file, 'a.mjs');
  assert.equal(picked[0].startLine, 1);
  // Pos 2 should prefer b.mjs (new file + uncovered query term) over redundant clone in a.mjs
  assert.equal(picked[1].file, 'b.mjs');
  assert.equal(picked[1].symbol, 'loadNetwork');

  // Respects maxTokens budget for Pos 2..K
  const tight = selectPauliSlices(candidates, ['findBridge', 'loadNetwork'], {
    maxSlices: 3,
    maxTokens: 20,
  });
  assert.equal(tight.length, 1);
});

// --- P3: Shell-Diet CCR + Normalized Delta Mode ---
test('P3: normalizeForDelta strips ANSI and normalizes timestamps, UUIDs, and durations', () => {
  const line =
    '\x1b[32mINFO\x1b[0m 2026-11-25T17:08:00.123Z 14:22:10.500 req=550e8400-e29b-41d4-a716-446655440000 done in 42.5ms (total 2 s)';
  assert.equal(
    stripAnsi(line),
    'INFO 2026-11-25T17:08:00.123Z 14:22:10.500 req=550e8400-e29b-41d4-a716-446655440000 done in 42.5ms (total 2 s)'
  );
  assert.equal(
    normalizeForDelta(line),
    'INFO <TS> <TS> req=<UUID> done in <DUR> (total <DUR>)'
  );
});

test('P3: runShellDiet caches long output and suppresses volatile Delta duplicates with --dsl', () => {
  const dir = makeTmpDir('ts-shell-');
  try {
    const emitScript = path.join(dir, 'emit.mjs');
    fs.writeFileSync(
      emitScript,
      [
        'const ts = new Date().toISOString();',
        'const id = "11111111-2222-3333-4444-" + String(Date.now()).slice(-12).padStart(12, "0");',
        'for (let i = 1; i <= 15; i++) {',
        '  console.log(`\\x1b[36m[${ts}]\\x1b[0m job=${id} step=${i} took ${i * 3}ms`);',
        '}',
        'if (process.argv.includes("--fail")) console.log("ERROR: disk quota exceeded");',
      ].join('\n'),
      'utf8'
    );

    const cmd = `node "${emitScript}"`;
    const r1 = execFileSync(
      process.execPath,
      [path.join(pkgRoot, 'src/shell-diet.mjs'), '--max', '5', '--dsl', '--', cmd],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.match(r1, /SHELL:SAVED\|LINES:15/);
    assert.ok(fs.existsSync(path.join(dir, '.tokenscalpel_cache')));

    // Second run with same volatile pattern but different timestamp/ms -> 0 new lines in delta!
    const r2 = execFileSync(
      process.execPath,
      [path.join(pkgRoot, 'src/shell-diet.mjs'), '--max', '5', '--dsl', '--', cmd],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.match(r2, /DELTA:NEW:0\/15/);

    // Verify runShellDiet handles empty command cleanly
    assert.equal(runShellDiet([], dir), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- P4: gitDiffSymbols (--diff) & findRefs (--refs) ---
test('P4: gitDiffSymbols intersects git diff hunks with outline symbols', () => {
  const dir = makeTmpDir('ts-diff-');
  try {
    const file = path.join(dir, 'mod.mjs');
    fs.writeFileSync(
      file,
      [
        'export function first() {',
        '  return 1;',
        '}',
        '',
        'export function second() {',
        '  return 2;',
        '}',
      ].join('\n'),
      'utf8'
    );
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['add', 'mod.mjs'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Edit only inside second()
    fs.writeFileSync(
      file,
      [
        'export function first() {',
        '  return 1;',
        '}',
        '',
        'export function second() {',
        '  return 200;',
        '}',
      ].join('\n'),
      'utf8'
    );

    const diffRes = gitDiffSymbols(file);
    assert.equal(diffRes.hunks.length, 1);
    assert.equal(diffRes.symbols.length, 1);
    assert.match(diffRes.symbols[0].text, /function second/);

    const cliDiff = execFileSync(
      process.execPath,
      [path.join(pkgRoot, 'src/outline.mjs'), file, '--diff', '--json'],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(cliDiff);
    assert.equal(parsed.symbols.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P4: findRefs classifies DEF/IMP/USO, skips ignored dirs and sensitive files, and caps at 35', () => {
  const dir = makeTmpDir('ts-refs-');
  try {
    fs.mkdirSync(path.join(dir, 'node_modules/pkg'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

    fs.writeFileSync(path.join(dir, 'node_modules/pkg/index.mjs'), 'export function targetSym() {}\n', 'utf8');
    fs.writeFileSync(path.join(dir, '.env'), 'targetSym=secret\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/def.mjs'), 'export function targetSym() { return 1; }\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src/use.mjs'), "import { targetSym } from './def.mjs';\nconst x = targetSym();\n", 'utf8');

    const manyLines = Array.from({ length: 45 }, (_, i) => `const u${i} = targetSym();`).join('\n');
    fs.writeFileSync(path.join(dir, 'src/many.mjs'), manyLines, 'utf8');

    const res = findRefs('targetSym', dir);
    assert.equal(res.truncated, true);
    assert.equal(res.refs.length, 35);
    assert.equal(res.refs[0].kind, 'DEF');
    assert.equal(res.refs[1].kind, 'IMP');
    assert.ok(res.refs.some((r) => r.kind === 'USO'));
    assert.ok(!res.refs.some((r) => r.file.includes('node_modules') || r.file.includes('.env')));

    const cliRefs = execFileSync(
      process.execPath,
      [path.join(pkgRoot, 'src/outline.mjs'), '--refs', 'targetSym', dir],
      { encoding: 'utf8' }
    );
    assert.match(cliRefs, /\[DEF\] src\/def\.mjs:1/);
    assert.match(cliRefs, /\[IMP\] src\/use\.mjs:1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- eval-models.mjs ---
test('eval-models: measureRepetitionRatio, scoreResponses, and --reference CLI', () => {
  const clean = 'This is a clear and varied response explaining how the function executes safely in production.';
  const loopy = 'hello world hello world hello world hello world hello world hello world hello world';
  assert.ok(measureRepetitionRatio(clean) < 0.1);
  assert.ok(measureRepetitionRatio(loopy) > 0.25);

  const scored = scoreResponses(
    clean,
    'Rest well tonight after that 10km run! [[SAVE_MEMORY: Ran 10km with Luna | sem: running, dog, tired]]',
    'AUDIT:PASS|FILES:src/engine.mjs#L628|DELTA:+3L/-0L'
  );
  assert.equal(scored.E1_ontologicalStability.pass, true);
  assert.equal(scored.E2_toolAutonomyInWarmChat.pass, true);
  assert.equal(scored.E3_hmasDslZeroProse.pass, true);

  const refOut = execFileSync(
    process.execPath,
    [path.join(pkgRoot, 'src/eval-models.mjs'), '--reference'],
    { encoding: 'utf8' }
  );
  assert.match(refOut, /TOKENSCALPEL .* VARIABLE-MODEL EMPIRICAL MATRIX/);
});
