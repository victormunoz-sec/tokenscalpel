import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * TokenScalpel Structural Outliner (`src/outline.mjs`) — 0 external dependencies
 * Extracts exact function, class, route, and heading line ranges before reading files,
 * eliminating blind full-file `read_file` token waste (70.1% of agent input volume).
 *
 * Usage:
 *   node src/outline.mjs <file>
 *   node src/outline.mjs <file> --slice 40:95
 *   node src/outline.mjs <file> --slice <symbolName>
 *   node src/outline.mjs <file> --diff
 *   node src/outline.mjs --refs <symbol> [dir]
 *   node src/outline.mjs <file> --json
 */

/**
 * Sensitive file denylist (F-02 Context-Leak Guard): prevents coding agents from dumping
 * `.env`, private keys, credentials, or private vaults into LLM context unless explicitly overridden.
 */
export const SENSITIVE_DENY_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|kdbx|sqlite|db)$/i,
  /^(id_rsa|id_ed25519|credentials\.json|\.npmrc)$/i,
  /private_vault\.md$/i,
];

export function isSensitiveFile(filePath) {
  const base = path.basename(String(filePath || ''));
  return SENSITIVE_DENY_PATTERNS.some((rx) => rx.test(base));
}

function assertSafeFile(absPath, allowSensitive = false) {
  if (!allowSensitive && isSensitiveFile(absPath)) {
    throw new Error(`SECURITY_BLOCK: Refusing to read sensitive file "${path.basename(absPath)}" into LLM context. Pass --allow-sensitive only if explicitly intended.`);
  }
}

function escapeRx(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getIndentWidth(line) {
  const m = line.match(/^(\s*)/);
  if (!m) return 0;
  let w = 0;
  for (const ch of m[1]) w += ch === '\t' ? 4 : 1;
  return w;
}

function computeMdEndLine(lines, startIdx) {
  const m = lines[startIdx].match(/^(#{1,6})\s+/);
  const level = m ? m[1].length : 1;
  let inFence = false;
  let fenceChar = '';
  for (let j = startIdx + 1; j < lines.length; j++) {
    const trimmed = lines[j].trimStart();
    const fm = trimmed.match(/^(`{3,}|~{3,})/);
    if (fm) {
      if (!inFence) {
        inFence = true;
        fenceChar = fm[1][0];
      } else if (fm[1][0] === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      continue;
    }
    if (inFence) continue;
    const hm = lines[j].match(/^(#{1,6})\s+/);
    if (hm && hm[1].length <= level) {
      return Math.max(startIdx + 1, j);
    }
  }
  return lines.length;
}

function computePyEndLine(lines, startIdx) {
  const baseIndent = getIndentWidth(lines[startIdx]);
  let parenDepth = 0;
  let sawColon = false;
  let tripleQuote = null;

  const updateTripleQuote = (line) => {
    let k = 0;
    while (k < line.length) {
      if (tripleQuote) {
        if (line[k] === '\\') { k += 2; continue; }
        if (line.startsWith(tripleQuote, k)) {
          tripleQuote = null;
          k += 3;
          continue;
        }
        k++;
        continue;
      }
      if (line[k] === '#') break;
      if (line.startsWith('"""', k) || line.startsWith("'''", k)) {
        tripleQuote = line.slice(k, k + 3);
        k += 3;
        continue;
      }
      if (line[k] === '\'' || line[k] === '"') {
        const q = line[k++];
        while (k < line.length) {
          if (line[k] === '\\') { k += 2; continue; }
          if (line[k] === q) { k++; break; }
          k++;
        }
        continue;
      }
      k++;
    }
  };

  const scanSigLine = (line) => {
    let q = null;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (q) {
        if (ch === '\\') { k++; continue; }
        if (ch === q) q = null;
        continue;
      }
      if (ch === '#') break;
      if (ch === '\'' || ch === '"') { q = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') parenDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === ':' && parenDepth === 0) sawColon = true;
    }
  };

  scanSigLine(lines[startIdx]);
  let inSignature = parenDepth > 0 || !sawColon;
  let lastNonEmpty = startIdx;

  for (let j = startIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    const wasInTriple = Boolean(tripleQuote);
    if (!inSignature) updateTripleQuote(line);

    if (line.trim() === '') {
      if (wasInTriple || tripleQuote) lastNonEmpty = j;
      continue;
    }
    if (inSignature) {
      scanSigLine(line);
      lastNonEmpty = j;
      if (parenDepth === 0 && sawColon) inSignature = false;
      continue;
    }
    if (wasInTriple) {
      lastNonEmpty = j;
      continue;
    }
    const indent = getIndentWidth(line);
    if (indent <= baseIndent) break;
    lastNonEmpty = j;
  }
  return lastNonEmpty + 1;
}

function computeHtmlTagEndLine(lines, startIdx) {
  const m = lines[startIdx].match(/^\s*<(style|script|header|main|aside|section)\b/i);
  if (!m) return computeBraceEndLine(lines, startIdx);
  const tag = m[1].toLowerCase();
  const openRx = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRx = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 0;
  let seenOpen = false;

  for (let j = startIdx; j < lines.length; j++) {
    const line = lines[j];
    const events = [];
    openRx.lastIndex = 0;
    closeRx.lastIndex = 0;
    let om;
    while ((om = openRx.exec(line)) !== null) {
      if (!om[0].endsWith('/>')) events.push({ idx: om.index, delta: 1 });
    }
    let cm;
    while ((cm = closeRx.exec(line)) !== null) {
      events.push({ idx: cm.index, delta: -1 });
    }
    events.sort((a, b) => a.idx - b.idx);
    for (const ev of events) {
      if (ev.delta > 0) {
        depth++;
        seenOpen = true;
      } else if (seenOpen) {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
  }
  return seenOpen ? lines.length : startIdx + 1;
}

const REGEX_PREV_CHARS = new Set([null, '=', '(', '[', ',', ':', '!', '?', '&', '|', ';', '{', '}', '~', '^', '+', '-', '*', '%']);

function computeBraceEndLine(lines, startIdx) {
  let depth = 0;
  let seenOpen = false;
  let inBlockComment = false;
  let quote = null;
  let parenDepth = 0;
  let lastCodeChar = null;
  const templateBraces = [];

  for (let j = startIdx; j < lines.length; j++) {
    const line = lines[j];
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      const next = line[k + 1];

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          k++;
        }
        continue;
      }

      if (quote) {
        if (ch === '\\') {
          k++;
          continue;
        }
        if (quote === '`' && ch === '$' && next === '{') {
          templateBraces.push(depth);
          depth++;
          seenOpen = true;
          quote = null;
          k++;
          lastCodeChar = '{';
          continue;
        }
        if (ch === quote) {
          quote = null;
          lastCodeChar = ch;
        }
        continue;
      }

      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        k++;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '/' && REGEX_PREV_CHARS.has(lastCodeChar)) {
        // Heuristic scan for single-line regex literal
        let rk = k + 1;
        let inClass = false;
        let closed = false;
        while (rk < line.length) {
          const rc = line[rk];
          if (rc === '\\') { rk += 2; continue; }
          if (rc === '[' && !inClass) inClass = true;
          else if (rc === ']' && inClass) inClass = false;
          else if (rc === '/' && !inClass) { closed = true; break; }
          rk++;
        }
        if (closed) {
          k = rk;
          lastCodeChar = '/';
          continue;
        }
      }

      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === '{') {
        if (seenOpen || parenDepth === 0) {
          depth++;
          seenOpen = true;
        }
      } else if (ch === '}') {
        if (seenOpen) {
          depth--;
          if (templateBraces.length && depth === templateBraces[templateBraces.length - 1]) {
            templateBraces.pop();
            quote = '`';
            lastCodeChar = '}';
            continue;
          }
          if (depth === 0) return j + 1;
        }
      } else if (!seenOpen && parenDepth === 0 && ch === ';') {
        return startIdx + 1;
      }

      if (!/\s/.test(ch)) lastCodeChar = ch;
    }

    if (!seenOpen && parenDepth === 0 && j - startIdx >= 3) {
      return startIdx + 1;
    }
  }

  return seenOpen ? lines.length : startIdx + 1;
}

export function extractSymbolName(entry) {
  const text = String(entry?.text || '');
  const kind = entry?.kind;
  if (kind === 'heading') return text.replace(/^#{1,6}\s+/, '').trim();
  if (kind === 'symbol') {
    const m = text.match(/^(?:async\s+)?(?:def|class)\s+([A-Za-z0-9_]+)/);
    return m ? m[1] : text;
  }
  if (kind === 'block') {
    const fm = text.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    if (fm) return fm[1];
    const tm = text.match(/^<([A-Za-z0-9_-]+)/);
    return tm ? tm[1].toLowerCase() : text;
  }
  const jm = text.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_]+)/)
    || text.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)/);
  return jm ? jm[1] : text;
}

export function outlineFile(filePath, options = {}) {
  const abs = path.resolve(filePath);
  assertSafeFile(abs, Boolean(options.allowSensitive));
  const raw = fs.readFileSync(abs, 'utf8');
  const lines = raw.split(/\r?\n/);
  const ext = path.extname(abs).toLowerCase();
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const ln = i + 1;
    let kind = null;

    if (ext === '.md') {
      if (/^#{1,3}\s+/.test(l)) kind = 'heading';
    } else if (ext === '.py') {
      if (/^\s*(async\s+)?def\s+[A-Za-z0-9_]+|^\s*class\s+[A-Za-z0-9_]+/.test(l)) kind = 'symbol';
    } else if (ext === '.html' || ext === '.htm') {
      if (/^\s*(export\s+)?(async\s+)?function\s+[A-Za-z0-9_]+|^\s*<(style|script|header|main|aside|section)\b/i.test(l)) kind = 'block';
    } else {
      // JS / TS / MJS / TSX
      if (/^\s*(export\s+)?(default\s+)?(async\s+)?function\s+[A-Za-z0-9_]+/.test(l)) kind = 'function';
      else if (/^\s*(export\s+)?class\s+[A-Za-z0-9_]+/.test(l)) kind = 'class';
      else if (/^\s*(export\s+)?(const|let)\s+[A-Za-z0-9_]+\s*=\s*(async\s*)?\([^)]*\)\s*=>/.test(l)) kind = 'arrow';
      else if (/^\s*if\s*\(req\.method\s*===|^\s*(app|router)\.(get|post|put|delete|patch)\(/.test(l)) kind = 'route';
    }

    if (kind) {
      let endLine = ln;
      if (ext === '.md') endLine = computeMdEndLine(lines, i);
      else if (ext === '.py') endLine = computePyEndLine(lines, i);
      else if (ext === '.html' || ext === '.htm') endLine = computeHtmlTagEndLine(lines, i);
      else endLine = computeBraceEndLine(lines, i);

      entries.push({ line: ln, endLine: Math.max(ln, endLine), kind, text: l.trim().slice(0, 100) });
    }
  }

  return {
    file: path.basename(abs),
    totalLines: lines.length,
    totalChars: raw.length,
    estTokensFull: Math.round(raw.length / 4),
    entries,
  };
}

export function sliceFile(filePath, startLine, endLine, options = {}) {
  const abs = path.resolve(filePath);
  assertSafeFile(abs, Boolean(options.allowSensitive));
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const s = Math.max(1, Number(startLine) || 1);
  const e = Math.min(lines.length, Number(endLine) || s + 40);
  const body = lines.slice(s - 1, e).map((l, idx) => `${s + idx}: ${l}`).join('\n');
  return { file: path.basename(abs), startLine: s, endLine: e, chars: body.length, estTokens: Math.round(body.length / 4), body };
}

export function sliceBySymbol(filePath, symbolName, options = {}) {
  const out = outlineFile(filePath, options);
  const target = String(symbolName || '').trim();
  const targetLower = target.toLowerCase();
  const wordRx = new RegExp(`\\b${escapeRx(target)}\\b`, 'i');

  const match =
    out.entries.find((e) => extractSymbolName(e) === target) ||
    out.entries.find((e) => extractSymbolName(e).toLowerCase() === targetLower) ||
    out.entries.find((e) => wordRx.test(e.text)) ||
    out.entries.find((e) => e.text.toLowerCase().includes(targetLower));

  if (!match) {
    throw new Error(`SYMBOL_NOT_FOUND: Symbol "${target}" not found in outline of ${out.file}`);
  }
  return {
    ...sliceFile(filePath, match.line, match.endLine, options),
    symbol: extractSymbolName(match),
    kind: match.kind,
  };
}

export function gitDiffSymbols(filePath, options = {}) {
  const abs = path.resolve(filePath);
  assertSafeFile(abs, Boolean(options.allowSensitive));
  const out = outlineFile(abs, options);

  let diffOutput = '';
  try {
    diffOutput = execFileSync('git', ['diff', '--unified=0', '--', path.basename(abs)], {
      cwd: path.dirname(abs),
      encoding: 'utf8',
    });
  } catch (err) {
    throw new Error(`GIT_DIFF_ERROR: ${err.message}`);
  }

  const hunks = [];
  const hunkRx = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
  let m;
  while ((m = hunkRx.exec(diffOutput)) !== null) {
    const ini = Number(m[1]);
    const cnt = m[2] !== undefined ? Number(m[2]) : 1;
    const start = Math.max(1, ini);
    const end = cnt === 0 ? start : ini + cnt - 1;
    hunks.push({ start, count: cnt, end });
  }

  const symbols = out.entries.filter((entry) =>
    hunks.some((h) => entry.line <= h.end && entry.endLine >= h.start)
  );

  return {
    file: out.file,
    totalLines: out.totalLines,
    hunks,
    symbols,
  };
}

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache_salidas',
  'coverage',
  '.tokenscalpel_cache',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.html', '.htm',
]);

export function findRefs(symbol, rootDir = '.', options = {}) {
  const sym = String(symbol || '').trim();
  if (!sym) throw new Error('findRefs requires a non-empty symbol name');

  const absRoot = path.resolve(rootDir);
  const maxResults = options.maxResults ?? 35;
  const allowSensitive = Boolean(options.allowSensitive);
  const symRxStr = escapeRx(sym);
  const wordRx = new RegExp(`\\b${symRxStr}\\b`);
  const defRx = new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|class|def|interface|type|enum)\\s+${symRxStr}\\b|^\\s*(?:export\\s+)?(?:const|let|var)\\s+${symRxStr}\\s*=`,
  );
  const impRx = /^\s*(?:import\b|from\s+\S+\s+import\b|export\s+\{[^}]*\}\s+from\b|.*=\s*require\s*\()/;

  const allRefs = [];

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name));
        continue;
      }
      if (!ent.isFile()) continue;
      const fullPath = path.join(dir, ent.name);
      if (!allowSensitive && isSensitiveFile(fullPath)) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;

      let raw;
      try {
        raw = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      if (!wordRx.test(raw)) continue;

      const rel = path.relative(absRoot, fullPath).replace(/\\/g, '/');
      const lines = raw.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!wordRx.test(line)) continue;
        let kind = 'USO';
        if (impRx.test(line)) kind = 'IMP';
        else if (defRx.test(line)) kind = 'DEF';
        allRefs.push({
          kind,
          file: rel,
          line: i + 1,
          text: line.trim().slice(0, 120),
        });
      }
    }
  };

  walk(absRoot);

  const rank = { DEF: 0, IMP: 1, USO: 2 };
  allRefs.sort((a, b) => rank[a.kind] - rank[b.kind] || a.file.localeCompare(b.file) || a.line - b.line);

  return {
    symbol: sym,
    rootDir: absRoot,
    total: allRefs.length,
    truncated: allRefs.length > maxResults,
    refs: allRefs.slice(0, maxResults),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const allowSensitive = args.includes('--allow-sensitive');
  const hasDiff = args.includes('--diff');
  const sliceIdx = args.indexOf('--slice');
  const refsIdx = args.indexOf('--refs');

  try {
    if (refsIdx !== -1) {
      const symbol = args[refsIdx + 1];
      const maybeDir = args[refsIdx + 2];
      const dir = maybeDir && !maybeDir.startsWith('--') ? maybeDir : '.';
      if (!symbol || symbol.startsWith('--')) {
        console.log('Usage: node src/outline.mjs --refs <symbol> [dir] [--json]');
        process.exit(0);
      }
      const res = findRefs(symbol, dir, { allowSensitive });
      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`[TokenScalpel Refs] "${res.symbol}" in ${res.rootDir} (${res.refs.length}${res.truncated ? `/${res.total}` : ''} matches)`);
        for (const r of res.refs) {
          console.log(`[${r.kind}] ${r.file}:${r.line} ${r.text}`);
        }
      }
      process.exit(0);
    }

    const skipIndices = new Set();
    if (sliceIdx !== -1) skipIndices.add(sliceIdx + 1);
    const fileArg = args.find((a, i) => !a.startsWith('--') && !skipIndices.has(i));

    if (!fileArg) {
      console.log('Usage: node src/outline.mjs <file> [--slice start:end | <symbolName>] [--diff] [--refs <symbol> [dir]] [--json] [--allow-sensitive]');
      process.exit(0);
    }

    if (hasDiff) {
      const res = gitDiffSymbols(fileArg, { allowSensitive });
      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`[TokenScalpel Diff] ${res.file} (${res.hunks.length} hunks -> ${res.symbols.length} affected symbols)`);
        if (res.symbols.length === 0) {
          console.log('(no modified symbols)');
        } else {
          for (const e of res.symbols) {
            console.log(`L${e.line}-L${e.endLine} [${e.kind}] ${e.text}`);
          }
        }
      }
    } else if (sliceIdx !== -1 && args[sliceIdx + 1]) {
      const sliceArg = args[sliceIdx + 1];
      const rangeMatch = sliceArg.match(/^(\d+):(\d+)$/);
      const out = rangeMatch
        ? sliceFile(fileArg, Number(rangeMatch[1]), Number(rangeMatch[2]), { allowSensitive })
        : sliceBySymbol(fileArg, sliceArg, { allowSensitive });
      if (asJson) console.log(JSON.stringify(out, null, 2));
      else console.log(`[TokenScalpel Slice] ${out.file} L${out.startLine}-L${out.endLine} (~${out.estTokens} tokens)\n${out.body}`);
    } else {
      const out = outlineFile(fileArg, { allowSensitive });
      if (asJson) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        const rendered = out.entries.map((e) => `L${e.line}-L${e.endLine} [${e.kind}] ${e.text}`).join('\n');
        const outlineTok = Math.round(rendered.length / 4);
        const savePct = out.estTokensFull > 0 ? Math.round(((out.estTokensFull - outlineTok) / out.estTokensFull) * 100) : 0;
        console.log(`[TokenScalpel Outline] ${out.file} (${out.totalLines} lines · ~${out.estTokensFull} full tokens -> ~${outlineTok} outline tokens · -${savePct}%)`);
        console.log(rendered);
      }
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
