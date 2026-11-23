import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * TokenScalpel Structural Outliner (`src/outline.mjs`) — 0 external dependencies
 * Extracts exact function, class, route, and heading line numbers before reading files,
 * eliminating blind full-file `read_file` token waste (70.1% of agent input volume).
 *
 * Usage:
 *   node src/outline.mjs <file>
 *   node src/outline.mjs <file> --slice 40:95
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
      entries.push({ line: ln, kind, text: l.trim().slice(0, 100) });
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const allowSensitive = args.includes('--allow-sensitive');
  const sliceIdx = args.indexOf('--slice');
  const fileArg = args.find((a, i) => !a.startsWith('--') && (sliceIdx === -1 || i !== sliceIdx + 1));

  if (!fileArg) {
    console.log('Usage: node src/outline.mjs <file> [--slice start:end] [--json] [--allow-sensitive]');
    process.exit(0);
  }

  try {
    if (sliceIdx !== -1 && args[sliceIdx + 1]) {
      const [s, e] = args[sliceIdx + 1].split(':').map(Number);
      const out = sliceFile(fileArg, s, e, { allowSensitive });
      if (asJson) console.log(JSON.stringify(out, null, 2));
      else console.log(`[TokenScalpel Slice] ${out.file} L${out.startLine}-L${out.endLine} (~${out.estTokens} tokens)\n${out.body}`);
    } else {
      const out = outlineFile(fileArg, { allowSensitive });
      if (asJson) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        const rendered = out.entries.map((e) => `L${e.line} [${e.kind}] ${e.text}`).join('\n');
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
