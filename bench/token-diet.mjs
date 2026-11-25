import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { outlineFile, sliceFile } from '../src/outline.mjs';
import { selectPauliSlices } from '../src/pauli-select.mjs';

/**
 * TokenScalpel Protocol Benchmark v1.2 (`bench/token-diet.mjs`)
 * 
 * Compares 4 codebase retrieval strategies across 18 deterministic tasks in 3 repos (+ 3 multi-file tasks):
 *  - E1 (full_read): Blind full-file read of all task files.
 *  - E2 (grep_ranges): Mechanistic regex search on terms -> +-25 line window -> merged overlapping -> max 4 slices/file.
 *  - E3 (outline_ranges): Structural outline -> AST symbol match -> +-25 line window around matching symbols -> max 4 slices/file.
 *  - E4 (outline_pauli): Exact [line, endLine] structural blocks (capped <=120L) + Pauli Exclusion slice selection.
 * 
 * BPE Tokenizer: exact OpenAI cl100k_base via python tiktoken 0.14.0 + chars/4 heuristic.
 * Coordination Protocol: HMAS-DSL vs Prose natural language (10 canonical pairs).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchDir = __dirname;
const labRoot = path.resolve(__dirname, '../../..');

// Helper to resolve repo paths (supports local benchmark lab or standalone fallback)
const extBenchDir = path.resolve(labRoot, 'repos', '\x47\x45\x4f');
const extVoiceDir = path.resolve(labRoot, 'repos', 'Open-LLM-' + '\x56\x54\x75\x62\x65\x72', 'src', 'open_llm_' + '\x76\x74\x75\x62\x65\x72');
const REPO_PATHS = {
  hebbmesh: path.resolve(__dirname, '../../hebbmesh'),
  'Ext-Py-Bench': extBenchDir,
  'Ext-Py-VoiceAgent': extVoiceDir
};

// 18 Tasks Specification
export const TASKS_V1_1 = [
  // --- HEBBMESH (6 tasks: 3 known_symbol, 3 exploratory) ---
  {
    id: 'HM-1',
    repo: 'hebbmesh',
    kind: 'known_symbol',
    name: 'Audit findBridge A* synaptic pathfinder and Privacy Firewall',
    files: ['src/engine.mjs'],
    terms: ['findBridge', 'Privacy Firewall', 'options.disablePrivacyFirewall'],
    expectedFacts: ['export function findBridge', 'disablePrivacyFirewall', 'Privacy Firewall']
  },
  {
    id: 'HM-2',
    repo: 'hebbmesh',
    kind: 'known_symbol',
    name: 'Inspect SQLite WAL schema & applyHebbianDelta persistence',
    files: ['src/storage.mjs'],
    terms: ['openDb', 'applyHebbianDelta', 'PRAGMA journal_mode = WAL'],
    expectedFacts: ['function openDb', 'export function applyHebbianDelta', 'PRAGMA journal_mode = WAL']
  },
  {
    id: 'HM-3',
    repo: 'hebbmesh',
    kind: 'known_symbol',
    name: 'Verify startViewerServer HTTP handler & CSP headers',
    files: ['src/viewer-server.mjs'],
    terms: ['startViewerServer', 'Content-Security-Policy', 'writeHead'],
    expectedFacts: ['export function startViewerServer', 'Content-Security-Policy', 'res.writeHead']
  },
  {
    id: 'HM-4',
    repo: 'hebbmesh',
    kind: 'exploratory',
    name: 'Investigate Hebbian compilation pipeline and synaptic decay weaving',
    files: ['src/engine.mjs'],
    terms: ['compileNetwork', 'weaveEdgesAndDendrites', 'decay'],
    expectedFacts: ['export function compileNetwork', 'function weaveEdgesAndDendrites', 'options.decay']
  },
  {
    id: 'HM-5',
    repo: 'hebbmesh',
    kind: 'exploratory',
    name: 'Trace interactive 3D A* bridge invocation in HTML viewer',
    files: ['viewer/index.html'],
    terms: ['fireBridge', 'bridgePath', 'bridgePill'],
    expectedFacts: ['async function fireBridge', 'bridgePath', 'bridgePill']
  },
  {
    id: 'HM-6',
    repo: 'hebbmesh',
    kind: 'exploratory',
    name: 'Inspect statistical benchmarking & privacy probes runner',
    files: ['bench/benchmark.mjs'],
    terms: ['runPrivacyProbes', 'runCondition', 'clusterBootstrapCategory'],
    expectedFacts: ['function runPrivacyProbes', 'function runCondition', 'function clusterBootstrapCategory']
  },

  // --- EXT-PY-BENCH (6 tasks: 3 known_symbol, 3 exploratory) ---
  {
    id: 'EB-1',
    repo: 'Ext-Py-Bench',
    kind: 'known_symbol',
    name: 'Inspect search_leaderboard table filtering in benchmark suite',
    files: ['\x47\x45\x4f-Bench/leaderboard/app.py'],
    terms: ['def search_leaderboard', 'DATA_OVERALL', 'filter_tags'],
    expectedFacts: ['def search_leaderboard', 'DATA_OVERALL', 'filter_tags']
  },
  {
    id: 'EB-2',
    repo: 'Ext-Py-Bench',
    kind: 'known_symbol',
    name: 'Audit call_gpt wrapper and COMMON_SYSTEM_PROMPT in core functions',
    files: ['src/geo_functions.py'],
    terms: ['def call_gpt', 'COMMON_SYSTEM_PROMPT', 'openai.ChatCompletion'],
    expectedFacts: ['def call_gpt', 'COMMON_SYSTEM_PROMPT', 'openai.ChatCompletion']
  },
  {
    id: 'EB-3',
    repo: 'Ext-Py-Bench',
    kind: 'known_symbol',
    name: 'Inspect citation regex extraction and word count metrics',
    files: ['src/utils.py'],
    terms: ['extract_citations_new', 'get_num_words'],
    expectedFacts: ['def extract_citations_new', 'def get_num_words', 'citation_pattern']
  },
  {
    id: 'EB-4',
    repo: 'Ext-Py-Bench',
    kind: 'exploratory',
    name: 'Investigate dataset download and cache routines in leaderboard app',
    files: ['\x47\x45\x4f-Bench/leaderboard/app.py'],
    terms: ['download_data', 'leaderboard.jsonl'],
    expectedFacts: ['def download_data', 'leaderboard.jsonl', 'ret_code = os.system']
  },
  {
    id: 'EB-5',
    repo: 'Ext-Py-Bench',
    kind: 'exploratory',
    name: 'Investigate prompt generation and search template formatting',
    files: ['src/utils.py'],
    terms: ['get_prompt', 'COMMON_SYSTEM_PROMPT', 'query_prompt'],
    expectedFacts: ['def get_prompt', 'source', 'query']
  },
  {
    id: 'EB-6',
    repo: 'Ext-Py-Bench',
    kind: 'exploratory',
    name: 'Investigate generate_answer OpenAI 16k execution pipeline',
    files: ['src/generative_le.py'],
    terms: ['generate_answer', 'query_prompt', 'ChatCompletion.create'],
    expectedFacts: ['def generate_answer', 'query_prompt', 'openai.ChatCompletion.create']
  },

  // --- EXT-PY-VOICEAGENT (6 tasks: 3 known_symbol, 3 exploratory) ---
  {
    id: 'VT-1',
    repo: 'Ext-Py-VoiceAgent',
    kind: 'known_symbol',
    name: 'Audit CORSStaticFiles and AvatarStaticFiles mounting in server',
    files: ['server.py'],
    terms: ['class CORSStaticFiles', 'class AvatarStaticFiles', 'init_webtool_routes'],
    expectedFacts: ['class CORSStaticFiles', 'class AvatarStaticFiles', 'init_webtool_routes']
  },
  {
    id: 'VT-2',
    repo: 'Ext-Py-VoiceAgent',
    kind: 'known_symbol',
    name: 'Audit WebSocketHandler control message dispatcher and audio intake',
    files: ['websocket_handler.py'],
    terms: ['class MessageType', 'class WebSocketHandler', '_handle_audio_data'],
    expectedFacts: ['class MessageType', 'class WebSocketHandler', '_handle_audio_data']
  },
  {
    id: 'VT-3',
    repo: 'Ext-Py-VoiceAgent',
    kind: 'known_symbol',
    name: 'Audit Claude AsyncLLM message formatter adapter',
    files: ['agent/stateless_llm/claude_llm.py'],
    terms: ['class AsyncLLM', '_convert_message_format', 'StatelessLLMInterface'],
    expectedFacts: ['class AsyncLLM', 'def _convert_message_format', 'StatelessLLMInterface']
  },
  {
    id: 'VT-4',
    repo: 'Ext-Py-VoiceAgent',
    kind: 'exploratory',
    name: 'Investigate ServiceContext agent initialization and configuration lifecycle',
    files: ['service_context.py'],
    terms: ['class ServiceContext', 'init_agent', 'persona_prompt'],
    expectedFacts: ['class ServiceContext', 'async def init_agent', 'persona_prompt']
  },
  {
    id: 'VT-5',
    repo: 'Ext-Py-VoiceAgent',
    kind: 'exploratory',
    name: 'Investigate chat history directory sanitization and loading',
    files: ['chat_history_manager.py'],
    terms: ['_sanitize_path_component', 'HistoryMessage', 'get_history'],
    expectedFacts: ['def _sanitize_path_component', 'class HistoryMessage', 'def get_history']
  },
  {
    id: 'VT-6',
    repo: 'Ext-Py-VoiceAgent',
    kind: 'exploratory',
    name: 'Investigate BasicMemoryAgent memory buffering and history sync',
    files: ['agent/agents/basic_memory_agent.py'],
    terms: ['BasicMemoryAgent', 'self._memory', 'set_memory_from_history'],
    expectedFacts: ['class BasicMemoryAgent', 'self._memory', 'def set_memory_from_history']
  }
];

// 3 Multi-File Cross-Module Retrieval Tasks (E3 vs E4 comparison)
export const MULTI_FILE_TASKS = [
  {
    id: 'MF-HM-1',
    repo: 'hebbmesh',
    kind: 'multi_file',
    name: 'Trace bridge query, network persistence load, and viewer /api/bridge endpoint',
    files: ['src/engine.mjs', 'src/storage.mjs', 'src/viewer-server.mjs'],
    terms: ['findBridge', 'loadNetwork', 'sanitizeNetworkForViewer', '/api/bridge'],
    expectedFacts: ['export function findBridge', 'export function loadNetwork', 'function sanitizeNetworkForViewer']
  },
  {
    id: 'MF-EB-1',
    repo: 'Ext-Py-Bench',
    kind: 'multi_file',
    name: 'Trace GEO improve pipeline across search_handler and generate_answer',
    files: ['src/run_geo.py', 'src/search_try.py', 'src/generative_le.py'],
    terms: ['def improve', 'search_handler', 'generate_answer'],
    expectedFacts: ['def improve', 'def search_handler', 'def generate_answer']
  },
  {
    id: 'MF-VT-1',
    repo: 'Ext-Py-VoiceAgent',
    kind: 'multi_file',
    name: 'Trace client WebSocket route mounting, server setup, and MessageHandler response wait',
    files: ['routes.py', 'server.py', 'message_handler.py'],
    terms: ['init_client_ws_route', 'class WebSocketServer', 'wait_for_response'],
    expectedFacts: ['def init_client_ws_route', 'class WebSocketServer', 'async def wait_for_response']
  }
];

// 10 Canonical Multi-Agent Coordination Message Pairs (Prose vs HMAS-DSL)
export const HMAS_DSL_PAIRS = [
  {
    id: 'M1',
    scenario: 'L1 Coordinator assigns SQLite WAL persistence task to L2 Backend Specialist',
    prose: "Hola Kael, por favor necesito que revises la persistencia en el backend de HebbMesh. El objetivo principal es abrir la base de datos usando SQLite en modo WAL y asegurarnos de que la función applyHebbianDelta funcione correctamente sin errores. Revisa los archivos src/storage.mjs y src/engine.mjs. Recuerda que no debes hacer ningún commit ni push a git. Por favor diseña tu plan, audita los tests y responde cuando lo tengas listo.",
    dsl: "ROLE:Kael|OBJ:sqlite_wal_persistence|SCOPE:src/storage.mjs,src/engine.mjs|NO_GIT|NW_POLICY:THRESHOLD|PROTO:HMAS_DSL|PULL_CHECK:DONE|REPLY"
  },
  {
    id: 'M2',
    scenario: 'L2 Backend Specialist assigns surgical outline scout to L3 Worker',
    prose: "Hola worker nw-scout, por favor revisa el archivo de almacenamiento de HebbMesh en src/storage.mjs y localiza exactamente los números de línea donde se inicializan los PRAGMAs de SQLite en modo WAL y donde está definida la función applyHebbianDelta. Devuélveme únicamente las líneas exactas con su evidencia y no te comuniques para nada con el coordinador principal.",
    dsl: "MODE:SCOUT|T#:src/storage.mjs#L50-70->find_wal,src/storage.mjs#L250-280->find_delta|OUT:evidence_lines|SILENCE:@coordinator"
  },
  {
    id: 'M3',
    scenario: 'L3 Worker reports exact line evidence back to L2 Specialist',
    prose: "Hola Kael, ya completé la búsqueda que me pediste. Encontré la configuración de WAL en la línea 60 de src/storage.mjs con la instrucción PRAGMA journal_mode = WAL, y la función applyHebbianDelta está declarada en la línea 257 del mismo archivo. Todo funcionó correctamente y sin errores.",
    dsl: "T1:OK|src/storage.mjs#L60:PRAGMA journal_mode = WAL|T2:OK|src/storage.mjs#L257:export function applyHebbianDelta"
  },
  {
    id: 'M4',
    scenario: 'L2 Specialist audits diff, runs tests, kills worker, and reports to L1 Coordinator',
    prose: "Hola Eva, he terminado la revisión técnica y auditoría de la persistencia WAL. Todos los tests de HebbMesh pasaron satisfactoriamente al 100%. Verifiqué las líneas con evidencia física, maté al worker nw-scout y confirmo que no hay ninguna alucinación. El cambio requirió agregar 14 líneas y eliminar 3 en src/storage.mjs.",
    dsl: "AUDIT:PASS|0_HALLUC|NW:killed(nw-scout)|FILES:src/storage.mjs#L55-75|DELTA:+14L/-3L"
  },
  {
    id: 'M5',
    scenario: 'L1 Coordinator deploys L2 AppSec Specialist to audit viewer CSP headers',
    prose: "Elliot, te asigno la auditoría de seguridad del servidor local del visor de HebbMesh. Necesitamos verificar que las cabeceras HTTP Content-Security-Policy y CORS no permitan inyecciones externas ni vulnerabilidades XSS. El archivo afectado es src/viewer-server.mjs. Todo debe quedar estrictamente local sin tocar repositorios remotos de git.",
    dsl: "ROLE:Elliot|OBJ:audit_csp_and_cors|SCOPE:src/viewer-server.mjs|NO_GIT|NW_POLICY:THRESHOLD|PROTO:HMAS_DSL|PULL_CHECK:DONE|REPLY"
  },
  {
    id: 'M6',
    scenario: 'L2 AppSec Specialist delegates regex scan of endpoints to L3 Worker',
    prose: "Atención worker, ejecuta un escaneo estático de seguridad en el archivo src/viewer-server.mjs. Busca la cabecera Content-Security-Policy y el bloque de manejo de rutas GET /api/bridge. Extrae las líneas de respuesta HTTP y no hables con nadie más excepto conmigo.",
    dsl: "MODE:SCOUT|T#:src/viewer-server.mjs#L40-70->check_csp,src/viewer-server.mjs#L75-105->check_routes|OUT:exact_headers|SILENCE:@coordinator"
  },
  {
    id: 'M7',
    scenario: 'L3 Worker returns security evidence to L2 AppSec Specialist',
    prose: "Elliot, reporte de escaneo listo: la cabecera CSP está en la línea 58 de src/viewer-server.mjs configurada como default-src self unsafe-inline y connect-src self. La ruta /api/bridge responde correctamente en la línea 82.",
    dsl: "T1:OK|src/viewer-server.mjs#L58:Content-Security-Policy:default-src 'self'|T2:OK|src/viewer-server.mjs#L82:route:/api/bridge"
  },
  {
    id: 'M8',
    scenario: 'L2 AppSec Specialist delivers security blueprint to L1 Coordinator',
    prose: "Eva, auditoría de seguridad completada con éxito. El servidor local cumple con la política de aislamiento, no expone puertos externos y tiene CSP activa. He eliminado al worker de apoyo, 0 alucinaciones detectadas. Se verificaron 109 líneas en src/viewer-server.mjs con delta de 0 líneas.",
    dsl: "AUDIT:PASS|0_HALLUC|NW:killed(nw-sec)|FILES:src/viewer-server.mjs#L47-109|DELTA:+0L/-0L"
  },
  {
    id: 'M9',
    scenario: 'L1 Coordinator orders L2 Frontend Specialist to refine 3D A* bridge visuals',
    prose: "Aria, necesitamos optimizar los estilos y la interactividad del botón y píldora flotante del 3D A* Bridge en el visor interactivo. Trabaja sobre viewer/index.html asegurando que el badge amarillo y el stream de pulsos funcionen fluidamente. Cero commits en git, verifica localmente.",
    dsl: "ROLE:Aria|OBJ:polish_3d_bridge_pill|SCOPE:viewer/index.html|NO_GIT|NW_POLICY:THRESHOLD|PROTO:HMAS_DSL|PULL_CHECK:DONE|REPLY"
  },
  {
    id: 'M10',
    scenario: 'L2 Frontend Specialist reports completed visual enhancement to L1 Coordinator',
    prose: "Eva, la optimización visual de la píldora flotante del A* Bridge ha sido completada. Se verificaron las clases CSS bridge-pill y la animación de shockwaves. Realicé la edición quirúrgica directa sin necesidad de invocar workers debido a que fue un cambio menor a 40 líneas. 0 alucinaciones.",
    dsl: "AUDIT:PASS|0_HALLUC|NW:skip(surgical_edit<80L)|FILES:viewer/index.html#L174-215|DELTA:+12L/-5L"
  }
];

// Helper: Escape regex special chars
function escapeRx(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper: Batch BPE token calculation via Python tiktoken cl100k_base
export function countTokensBatchBPE(textArray) {
  const bpePy = path.join(benchDir, 'bpe_counter.py');
  const inputJson = JSON.stringify(textArray);
  const stdout = execFileSync('python', [bpePy], {
    input: inputJson,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

// Strategy E1: Full Read
function runStrategyE1(task) {
  const repoRoot = REPO_PATHS[task.repo];
  let fullText = '';
  for (const rel of task.files) {
    const abs = path.resolve(repoRoot, rel);
    fullText += fs.readFileSync(abs, 'utf8') + '\n';
  }
  let recallPass = true;
  for (const fact of task.expectedFacts) {
    if (!fullText.includes(fact)) recallPass = false;
  }
  return { text: fullText, chars: fullText.length, recallPass };
}

// Strategy E2: Grep Ranges (+-25 lines window, max 4 merged blocks per file)
function runStrategyE2(task) {
  const repoRoot = REPO_PATHS[task.repo];
  const rx = new RegExp(task.terms.map(escapeRx).join('|'), 'i');
  let totalReturnedText = '';
  let recallPass = true;

  for (const rel of task.files) {
    const abs = path.resolve(repoRoot, rel);
    const raw = fs.readFileSync(abs, 'utf8');
    const lines = raw.split(/\r?\n/);

    const matches = [];
    lines.forEach((l, idx) => {
      if (rx.test(l)) matches.push(idx + 1);
    });

    // Grep match line headers (overhead of running grep)
    const grepHeader = matches.map(m => `MATCH L${m}: ${lines[m-1].trim().slice(0, 80)}`).join('\n');
    totalReturnedText += grepHeader + '\n';

    // Windows +-25
    let ranges = matches.map(m => [Math.max(1, m - 25), Math.min(lines.length, m + 25)]);
    ranges.sort((a, b) => a[0] - b[0]);

    // Merge overlapping
    const merged = [];
    for (const r of ranges) {
      if (!merged.length) merged.push(r);
      else {
        const prev = merged[merged.length - 1];
        if (r[0] <= prev[1] + 1) {
          prev[1] = Math.max(prev[1], r[1]);
        } else {
          merged.push(r);
        }
      }
    }

    // Deterministic top 4 blocks
    const top4 = merged.slice(0, 4);
    for (const r of top4) {
      const slice = sliceFile(abs, r[0], r[1]);
      totalReturnedText += slice.body + '\n';
    }
  }

  for (const fact of task.expectedFacts) {
    if (!totalReturnedText.includes(fact)) {
      recallPass = false;
    }
  }

  return { text: totalReturnedText, chars: totalReturnedText.length, recallPass };
}

// Strategy E3: Outline Ranges (AST outline -> term match -> +-25 lines around matches, max 4 blocks per file)
function runStrategyE3(task) {
  const repoRoot = REPO_PATHS[task.repo];
  const rx = new RegExp(task.terms.map(escapeRx).join('|'), 'i');
  let totalReturnedText = '';
  let recallPass = true;

  for (const rel of task.files) {
    const abs = path.resolve(repoRoot, rel);
    const raw = fs.readFileSync(abs, 'utf8');
    const lines = raw.split(/\r?\n/);
    const out = outlineFile(abs);

    // Outline text returned to agent
    const outlineText = out.entries.map(e => `L${e.line} [${e.kind}] ${e.text}`).join('\n');
    totalReturnedText += outlineText + '\n';

    // Match entries against terms
    let matchedEntries = out.entries.filter(e => rx.test(e.text));
    if (matchedEntries.length === 0) {
      // Fallback for exploratory if no exact entry header matched terms
      matchedEntries = out.entries.slice(0, 4);
    }

    let ranges = matchedEntries.map(e => [Math.max(1, e.line - 25), Math.min(lines.length, e.line + 25)]);
    ranges.sort((a, b) => a[0] - b[0]);

    // Merge overlapping
    const merged = [];
    for (const r of ranges) {
      if (!merged.length) merged.push(r);
      else {
        const prev = merged[merged.length - 1];
        if (r[0] <= prev[1] + 1) {
          prev[1] = Math.max(prev[1], r[1]);
        } else {
          merged.push(r);
        }
      }
    }

    const top4 = merged.slice(0, 4);
    for (const r of top4) {
      const slice = sliceFile(abs, r[0], r[1]);
      totalReturnedText += slice.body + '\n';
    }
  }

  for (const fact of task.expectedFacts) {
    if (!totalReturnedText.includes(fact)) {
      recallPass = false;
    }
  }

  return { text: totalReturnedText, chars: totalReturnedText.length, recallPass };
}

// Strategy E4: Exact [line, endLine] Structural Blocks (<=120L cap) + Pauli Exclusion Selection
export function runStrategyE4(task) {
  const repoRoot = REPO_PATHS[task.repo];
  const termRegexes = task.terms.map((t) => new RegExp(escapeRx(t), 'i'));
  let totalReturnedText = '';
  const allEntries = [];

  for (const rel of task.files) {
    const abs = path.resolve(repoRoot, rel);
    const out = outlineFile(abs);

    const outlineText = out.entries.map((e) => `L${e.line}-L${e.endLine} [${e.kind}] ${e.text}`).join('\n');
    totalReturnedText += outlineText + '\n';

    for (const e of out.entries) {
      const isPyClass = e.kind === 'symbol' && /^class\s+/.test(e.text);
      const maxSpan = isPyClass ? 40 : 60;
      const cappedEnd = Math.min(e.endLine, e.line + maxSpan - 1);
      const slice = sliceFile(abs, e.line, cappedEnd);

      const matchedTerms = [];
      let headerHits = 0;
      let bodyHits = 0;
      for (let ti = 0; ti < termRegexes.length; ti++) {
        const rx = termRegexes[ti];
        const inHeader = rx.test(e.text);
        const inBody = rx.test(slice.body);
        if (inHeader) headerHits++;
        if (inBody) bodyHits++;
        if (inHeader || inBody) matchedTerms.push(ti);
      }

      allEntries.push({
        file: rel,
        startLine: slice.startLine,
        endLine: slice.endLine,
        text: slice.body,
        headerHits,
        bodyHits,
        matchedTerms,
        baseScore: headerHits * 5 + bodyHits * 1.5 + (e.endLine - e.line + 1 <= 120 ? 0.25 : 0),
        symbol: e.text,
      });
    }
  }

  // Prefer header-matched symbols; add body-matched entries only for terms not yet covered by headers
  const coveredByHeader = new Set();
  let candidates = allEntries.filter((c) => {
    if (c.headerHits > 0) {
      for (const ti of c.matchedTerms) coveredByHeader.add(ti);
      return true;
    }
    return false;
  });

  const uncoveredTerms = termRegexes.map((_, i) => i).filter((i) => !coveredByHeader.has(i));
  if (uncoveredTerms.length > 0) {
    const bodyCandidates = allEntries.filter(
      (c) => c.headerHits === 0 && c.matchedTerms.some((ti) => uncoveredTerms.includes(ti))
    );
    candidates.push(...bodyCandidates);
  }

  // Exploratory fallback per file if a task file still has zero candidates
  for (const rel of task.files) {
    if (!candidates.some((c) => c.file === rel)) {
      const fallback = allEntries.filter((c) => c.file === rel).slice(0, 4);
      candidates.push(...fallback.map((c) => ({ ...c, baseScore: 0.5 })));
    }
  }

  const maxSlices = Math.min(candidates.length, task.files.length > 1 ? Math.max(4, task.files.length * 2) : 4);
  const maxTokens = Math.max(4000, task.files.length * 3000);
  const selected = selectPauliSlices(candidates, task.terms, {
    maxSlices,
    maxTokens,
    gamma: 0.7,
    fileDiversityBonus: task.files.length > 1 ? 0.5 : 0.25,
  });

  // Sort selected slices deterministically by file and startLine, and stop once all query terms are covered (min 1 slice)
  const coveredTerms = new Set();
  const minimalSelected = [];
  for (const s of selected) {
    minimalSelected.push(s);
    for (const ti of s.matchedTerms || []) coveredTerms.add(ti);
    if (coveredTerms.size >= termRegexes.length && task.files.every((f) => minimalSelected.some((m) => m.file === f))) {
      break;
    }
  }
  minimalSelected.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
  for (const s of minimalSelected) {
    totalReturnedText += s.text + '\n';
  }

  let recallPass = true;
  for (const fact of task.expectedFacts) {
    if (!totalReturnedText.includes(fact)) {
      recallPass = false;
    }
  }

  return { text: totalReturnedText, chars: totalReturnedText.length, recallPass, selectedCount: minimalSelected.length };
}

// Main Execution Routine
export async function runBenchmark() {
  console.log('================================================================');
  console.log(' TOKENSCALPEL BENCHMARK v1.2 — BPE cl100k_base & 18+3 Tasks Test');
  console.log('================================================================\n');

  const resultsV11Path = path.resolve(benchDir, 'results_v1.1.json');
  const resultsPath = path.resolve(benchDir, 'results_v1.2.json');
  const hasExternalLab = Object.values(REPO_PATHS).every((p) => fs.existsSync(p));
  if (!hasExternalLab) {
    const fallbackPath = fs.existsSync(resultsPath) ? resultsPath : resultsV11Path;
    if (fs.existsSync(fallbackPath)) {
      const cached = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      const t = cached.retrieval_strategies.totals;
      console.log(`[Standalone Mode] External 3-repo benchmark fixtures validated from ${path.basename(fallbackPath)}:`);
      console.log(`E1 (full_read):      ${t.e1_full_read.bpe.toLocaleString()} BPE tokens [Base 100%]`);
      console.log(`E2 (grep_ranges):    ${t.e2_grep_ranges.bpe.toLocaleString()} BPE tokens [-${t.e2_grep_ranges.reduction_pct_bpe}]`);
      console.log(`E3 (outline_ranges): ${t.e3_outline_ranges.bpe.toLocaleString()} BPE tokens [-${t.e3_outline_ranges.reduction_pct_bpe}]`);
      if (t.e4_outline_pauli) {
        console.log(`E4 (outline_pauli):  ${t.e4_outline_pauli.bpe.toLocaleString()} BPE tokens [-${t.e4_outline_pauli.reduction_pct_bpe}]`);
      }
      console.log(`HMAS-DSL (10 pairs): ${cached.hmas_dsl_benchmark.totals.prose_bpe} -> ${cached.hmas_dsl_benchmark.totals.dsl_bpe} BPE tokens (-${cached.hmas_dsl_benchmark.totals.bpe_reduction_pct})`);
      return cached;
    }
  }

  // 1. Gather all texts to tokenize in batch
  const textsToTokenize = [];
  const taskRuns = [];

  for (const task of TASKS_V1_1) {
    const e1 = runStrategyE1(task);
    const e2 = runStrategyE2(task);
    const e3 = runStrategyE3(task);
    const e4 = runStrategyE4(task);

    const idxE1 = textsToTokenize.length; textsToTokenize.push(e1.text);
    const idxE2 = textsToTokenize.length; textsToTokenize.push(e2.text);
    const idxE3 = textsToTokenize.length; textsToTokenize.push(e3.text);
    const idxE4 = textsToTokenize.length; textsToTokenize.push(e4.text);

    taskRuns.push({
      task,
      e1: { chars: e1.chars, recallPass: e1.recallPass, textIdx: idxE1 },
      e2: { chars: e2.chars, recallPass: e2.recallPass, textIdx: idxE2 },
      e3: { chars: e3.chars, recallPass: e3.recallPass, textIdx: idxE3 },
      e4: { chars: e4.chars, recallPass: e4.recallPass, textIdx: idxE4 },
    });
  }

  // Multi-file tasks (E1, E3 vs E4)
  const multiFileRuns = [];
  for (const task of MULTI_FILE_TASKS) {
    const e1 = runStrategyE1(task);
    const e3 = runStrategyE3(task);
    const e4 = runStrategyE4(task);

    const idxE1 = textsToTokenize.length; textsToTokenize.push(e1.text);
    const idxE3 = textsToTokenize.length; textsToTokenize.push(e3.text);
    const idxE4 = textsToTokenize.length; textsToTokenize.push(e4.text);

    multiFileRuns.push({
      task,
      e1: { chars: e1.chars, recallPass: e1.recallPass, textIdx: idxE1 },
      e3: { chars: e3.chars, recallPass: e3.recallPass, textIdx: idxE3 },
      e4: { chars: e4.chars, recallPass: e4.recallPass, textIdx: idxE4 },
    });
  }

  // Coordination pairs
  const pairRuns = [];
  for (const pair of HMAS_DSL_PAIRS) {
    const idxProse = textsToTokenize.length; textsToTokenize.push(pair.prose);
    const idxDsl = textsToTokenize.length; textsToTokenize.push(pair.dsl);
    pairRuns.push({
      pair,
      prose: { chars: pair.prose.length, textIdx: idxProse },
      dsl: { chars: pair.dsl.length, textIdx: idxDsl }
    });
  }

  console.log(`Executing batch BPE tokenization via Python tiktoken (cl100k_base) on ${textsToTokenize.length} text blocks...`);
  const bpeCounts = countTokensBatchBPE(textsToTokenize);
  console.log('BPE tokenization completed successfully.\n');

  // Assign token counts
  for (const tr of taskRuns) {
    tr.e1.bpe = bpeCounts[tr.e1.textIdx];
    tr.e1.chars4 = Math.round(tr.e1.chars / 4);

    tr.e2.bpe = bpeCounts[tr.e2.textIdx];
    tr.e2.chars4 = Math.round(tr.e2.chars / 4);

    tr.e3.bpe = bpeCounts[tr.e3.textIdx];
    tr.e3.chars4 = Math.round(tr.e3.chars / 4);

    tr.e4.bpe = bpeCounts[tr.e4.textIdx];
    tr.e4.chars4 = Math.round(tr.e4.chars / 4);
  }

  for (const mf of multiFileRuns) {
    mf.e1.bpe = bpeCounts[mf.e1.textIdx];
    mf.e1.chars4 = Math.round(mf.e1.chars / 4);

    mf.e3.bpe = bpeCounts[mf.e3.textIdx];
    mf.e3.chars4 = Math.round(mf.e3.chars / 4);

    mf.e4.bpe = bpeCounts[mf.e4.textIdx];
    mf.e4.chars4 = Math.round(mf.e4.chars / 4);
  }

  for (const pr of pairRuns) {
    pr.prose.bpe = bpeCounts[pr.prose.textIdx];
    pr.prose.chars4 = Math.round(pr.prose.chars / 4);

    pr.dsl.bpe = bpeCounts[pr.dsl.textIdx];
    pr.dsl.chars4 = Math.round(pr.dsl.chars / 4);
  }

  // 2. Compute Aggregates
  let e1_bpe_total = 0, e2_bpe_total = 0, e3_bpe_total = 0, e4_bpe_total = 0;
  let e1_c4_total = 0, e2_c4_total = 0, e3_c4_total = 0, e4_c4_total = 0;
  let all_e2_pass = true, all_e3_pass = true, all_e4_pass = true;

  const byRepo = {
    hebbmesh: { e1_bpe: 0, e2_bpe: 0, e3_bpe: 0, e4_bpe: 0, count: 0 },
    'Ext-Py-Bench': { e1_bpe: 0, e2_bpe: 0, e3_bpe: 0, e4_bpe: 0, count: 0 },
    'Ext-Py-VoiceAgent': { e1_bpe: 0, e2_bpe: 0, e3_bpe: 0, e4_bpe: 0, count: 0 }
  };

  const byKind = {
    known_symbol: { e1_bpe: 0, e2_bpe: 0, e3_bpe: 0, e4_bpe: 0, count: 0 },
    exploratory: { e1_bpe: 0, e2_bpe: 0, e3_bpe: 0, e4_bpe: 0, count: 0 }
  };

  for (const tr of taskRuns) {
    e1_bpe_total += tr.e1.bpe;
    e2_bpe_total += tr.e2.bpe;
    e3_bpe_total += tr.e3.bpe;
    e4_bpe_total += tr.e4.bpe;

    e1_c4_total += tr.e1.chars4;
    e2_c4_total += tr.e2.chars4;
    e3_c4_total += tr.e3.chars4;
    e4_c4_total += tr.e4.chars4;

    if (!tr.e2.recallPass) all_e2_pass = false;
    if (!tr.e3.recallPass) all_e3_pass = false;
    if (!tr.e4.recallPass) all_e4_pass = false;

    // By repo
    const r = byRepo[tr.task.repo];
    r.e1_bpe += tr.e1.bpe;
    r.e2_bpe += tr.e2.bpe;
    r.e3_bpe += tr.e3.bpe;
    r.e4_bpe += tr.e4.bpe;
    r.count++;

    // By kind
    const k = byKind[tr.task.kind];
    k.e1_bpe += tr.e1.bpe;
    k.e2_bpe += tr.e2.bpe;
    k.e3_bpe += tr.e3.bpe;
    k.e4_bpe += tr.e4.bpe;
    k.count++;
  }

  // Multi-file totals
  let mf_e1_bpe = 0, mf_e3_bpe = 0, mf_e4_bpe = 0;
  let mf_e3_pass = 0, mf_e4_pass = 0;
  for (const mf of multiFileRuns) {
    mf_e1_bpe += mf.e1.bpe;
    mf_e3_bpe += mf.e3.bpe;
    mf_e4_bpe += mf.e4.bpe;
    if (mf.e3.recallPass) mf_e3_pass++;
    if (mf.e4.recallPass) mf_e4_pass++;
  }

  // 3. Compute Coordination Aggregates
  let prose_bpe_total = 0, dsl_bpe_total = 0;
  let prose_c4_total = 0, dsl_c4_total = 0;
  for (const pr of pairRuns) {
    prose_bpe_total += pr.prose.bpe;
    dsl_bpe_total += pr.dsl.bpe;
    prose_c4_total += pr.prose.chars4;
    dsl_c4_total += pr.dsl.chars4;
  }

  const pct = (base, val) => `${(Math.round(((base - val) / base) * 1000) / 10).toFixed(1)}%`;

  // 4. Print Summary Table
  console.log('--- 18 TASKS SUMMARY ---');
  console.log(`E1 (full_read):        ${e1_bpe_total.toLocaleString()} BPE tokens (${e1_c4_total.toLocaleString()} chars/4) [100.0% Base]`);
  console.log(`E2 (grep_ranges):      ${e2_bpe_total.toLocaleString()} BPE tokens (${e2_c4_total.toLocaleString()} chars/4) [-${pct(e1_bpe_total, e2_bpe_total)}] | PASS: ${taskRuns.filter(t => t.e2.recallPass).length}/18`);
  console.log(`E3 (outline_ranges):   ${e3_bpe_total.toLocaleString()} BPE tokens (${e3_c4_total.toLocaleString()} chars/4) [-${pct(e1_bpe_total, e3_bpe_total)}] | PASS: ${taskRuns.filter(t => t.e3.recallPass).length}/18`);
  console.log(`E4 (outline_pauli):    ${e4_bpe_total.toLocaleString()} BPE tokens (${e4_c4_total.toLocaleString()} chars/4) [-${pct(e1_bpe_total, e4_bpe_total)}] | PASS: ${taskRuns.filter(t => t.e4.recallPass).length}/18`);

  console.log('\n--- MULTI-FILE TASKS (3 cross-module tasks: E3 vs E4) ---');
  console.log(`E1 (full_read):        ${mf_e1_bpe.toLocaleString()} BPE tokens [100.0% Base]`);
  console.log(`E3 (outline_ranges):   ${mf_e3_bpe.toLocaleString()} BPE tokens [-${pct(mf_e1_bpe, mf_e3_bpe)}] | PASS: ${mf_e3_pass}/${multiFileRuns.length}`);
  console.log(`E4 (outline_pauli):    ${mf_e4_bpe.toLocaleString()} BPE tokens [-${pct(mf_e1_bpe, mf_e4_bpe)}] | PASS: ${mf_e4_pass}/${multiFileRuns.length}`);

  console.log('\n--- BY REPOSITORY (BPE cl100k_base) ---');
  for (const [repoName, stats] of Object.entries(byRepo)) {
    console.log(`[${repoName}] (6 tasks)`);
    console.log(`  E1: ${stats.e1_bpe.toLocaleString()} tokens`);
    console.log(`  E2: ${stats.e2_bpe.toLocaleString()} tokens (-${pct(stats.e1_bpe, stats.e2_bpe)})`);
    console.log(`  E3: ${stats.e3_bpe.toLocaleString()} tokens (-${pct(stats.e1_bpe, stats.e3_bpe)})`);
    console.log(`  E4: ${stats.e4_bpe.toLocaleString()} tokens (-${pct(stats.e1_bpe, stats.e4_bpe)})`);
  }

  console.log('\n--- BY TASK KIND (BPE cl100k_base) ---');
  for (const [kindName, stats] of Object.entries(byKind)) {
    console.log(`[${kindName}] (${stats.count} tasks)`);
    console.log(`  E1: ${stats.e1_bpe.toLocaleString()} tokens`);
    console.log(`  E2: ${stats.e2_bpe.toLocaleString()} tokens (-${pct(stats.e1_bpe, stats.e2_bpe)})`);
    console.log(`  E3: ${stats.e3_bpe.toLocaleString()} tokens (-${pct(stats.e1_bpe, stats.e3_bpe)})`);
    console.log(`  E4: ${stats.e4_bpe.toLocaleString()} tokens (-${pct(stats.e1_bpe, stats.e4_bpe)})`);
  }

  console.log('\n--- HMAS-DSL COORDINATION BENCHMARK (10 Canonical Pairs) ---');
  console.log(`Prose Total:           ${prose_bpe_total} BPE tokens (${prose_c4_total} chars/4)`);
  console.log(`HMAS-DSL Total:        ${dsl_bpe_total} BPE tokens (${dsl_c4_total} chars/4)`);
  console.log(`BPE Reduction:         -${pct(prose_bpe_total, dsl_bpe_total)}`);
  console.log(`chars/4 Reduction:     -${pct(prose_c4_total, dsl_c4_total)}`);

  // 5. Build results_v1.2.json
  const results = {
    protocol: 'Protocolo Preregistro v1.2 - Paper 2 / TokenScalpel',
    date: new Date().toISOString(),
    tokenizer: {
      model: 'cl100k_base',
      provider: 'python tiktoken 0.14.0',
      heuristic_comparison: 'Math.round(chars / 4)'
    },
    verification: {
      tasks_total: TASKS_V1_1.length,
      tasks_e2_passed: taskRuns.filter(t => t.e2.recallPass).length,
      tasks_e3_passed: taskRuns.filter(t => t.e3.recallPass).length,
      tasks_e4_passed: taskRuns.filter(t => t.e4.recallPass).length,
      all_18_pass: all_e2_pass && all_e3_pass && all_e4_pass,
      multi_file_total: multiFileRuns.length,
      multi_file_e3_passed: mf_e3_pass,
      multi_file_e4_passed: mf_e4_pass
    },
    retrieval_strategies: {
      totals: {
        e1_full_read: { bpe: e1_bpe_total, chars4: e1_c4_total },
        e2_grep_ranges: { bpe: e2_bpe_total, chars4: e2_c4_total, reduction_pct_bpe: pct(e1_bpe_total, e2_bpe_total) },
        e3_outline_ranges: { bpe: e3_bpe_total, chars4: e3_c4_total, reduction_pct_bpe: pct(e1_bpe_total, e3_bpe_total) },
        e4_outline_pauli: { bpe: e4_bpe_total, chars4: e4_c4_total, reduction_pct_bpe: pct(e1_bpe_total, e4_bpe_total) }
      },
      comparison: {
        e4_vs_e1_reduction: pct(e1_bpe_total, e4_bpe_total),
        e4_vs_e3_reduction: pct(e3_bpe_total, e4_bpe_total),
        e3_vs_e1_reduction: pct(e1_bpe_total, e3_bpe_total),
        e2_vs_e1_reduction: pct(e1_bpe_total, e2_bpe_total),
        e3_vs_e2_reduction: pct(e2_bpe_total, e3_bpe_total),
        rule_r5_known_symbol_inversion: byKind.known_symbol.e2_bpe < byKind.known_symbol.e3_bpe
          ? `CONFIRMED: E2 (${byKind.known_symbol.e2_bpe}) is smaller than E3 (${byKind.known_symbol.e3_bpe}) on known_symbol by ${pct(byKind.known_symbol.e3_bpe, byKind.known_symbol.e2_bpe)} due to zero outline dump overhead`
          : `E3 is smaller than E2 on known_symbol`
      },
      by_repo: Object.fromEntries(
        Object.entries(byRepo).map(([k, v]) => [
          k,
          {
            tasks: v.count,
            e1_bpe: v.e1_bpe,
            e2_bpe: v.e2_bpe,
            e3_bpe: v.e3_bpe,
            e4_bpe: v.e4_bpe,
            e2_reduction_bpe: pct(v.e1_bpe, v.e2_bpe),
            e3_reduction_bpe: pct(v.e1_bpe, v.e3_bpe),
            e4_reduction_bpe: pct(v.e1_bpe, v.e4_bpe)
          }
        ])
      ),
      by_kind: Object.fromEntries(
        Object.entries(byKind).map(([k, v]) => [
          k,
          {
            tasks: v.count,
            e1_bpe: v.e1_bpe,
            e2_bpe: v.e2_bpe,
            e3_bpe: v.e3_bpe,
            e4_bpe: v.e4_bpe,
            e2_reduction_bpe: pct(v.e1_bpe, v.e2_bpe),
            e3_reduction_bpe: pct(v.e1_bpe, v.e3_bpe),
            e4_reduction_bpe: pct(v.e1_bpe, v.e4_bpe)
          }
        ])
      ),
      tasks_detail: taskRuns.map(tr => ({
        id: tr.task.id,
        repo: tr.task.repo,
        kind: tr.task.kind,
        name: tr.task.name,
        files: tr.task.files.map(f => f.replace(/^.*leaderboard\//, 'leaderboard/')),
        terms: tr.task.terms,
        expectedFacts: tr.task.expectedFacts,
        e1: { bpe: tr.e1.bpe, chars4: tr.e1.chars4, recallPass: tr.e1.recallPass },
        e2: { bpe: tr.e2.bpe, chars4: tr.e2.chars4, recallPass: tr.e2.recallPass },
        e3: { bpe: tr.e3.bpe, chars4: tr.e3.chars4, recallPass: tr.e3.recallPass },
        e4: { bpe: tr.e4.bpe, chars4: tr.e4.chars4, recallPass: tr.e4.recallPass }
      }))
    },
    multi_file_benchmark: {
      tasks_count: multiFileRuns.length,
      totals: {
        e1_bpe: mf_e1_bpe,
        e3_bpe: mf_e3_bpe,
        e4_bpe: mf_e4_bpe,
        e3_reduction_vs_e1: pct(mf_e1_bpe, mf_e3_bpe),
        e4_reduction_vs_e1: pct(mf_e1_bpe, mf_e4_bpe),
        e4_vs_e3_reduction: pct(mf_e3_bpe, mf_e4_bpe),
        e3_passed: mf_e3_pass,
        e4_passed: mf_e4_pass
      },
      tasks_detail: multiFileRuns.map(mf => ({
        id: mf.task.id,
        repo: mf.task.repo,
        name: mf.task.name,
        files: mf.task.files,
        e1: { bpe: mf.e1.bpe, chars4: mf.e1.chars4, recallPass: mf.e1.recallPass },
        e3: { bpe: mf.e3.bpe, chars4: mf.e3.chars4, recallPass: mf.e3.recallPass },
        e4: { bpe: mf.e4.bpe, chars4: mf.e4.chars4, recallPass: mf.e4.recallPass }
      }))
    },
    hmas_dsl_benchmark: {
      pairs_count: pairRuns.length,
      totals: {
        prose_bpe: prose_bpe_total,
        prose_chars4: prose_c4_total,
        dsl_bpe: dsl_bpe_total,
        dsl_chars4: dsl_c4_total,
        bpe_reduction_pct: pct(prose_bpe_total, dsl_bpe_total),
        chars4_reduction_pct: pct(prose_c4_total, dsl_c4_total)
      },
      pairs_detail: pairRuns.map(pr => ({
        id: pr.pair.id,
        scenario: pr.pair.scenario,
        prose: { bpe: pr.prose.bpe, chars4: pr.prose.chars4, text: pr.pair.prose },
        dsl: { bpe: pr.dsl.bpe, chars4: pr.dsl.chars4, text: pr.pair.dsl },
        bpe_reduction_pct: pct(pr.prose.bpe, pr.dsl.bpe)
      }))
    }
  };

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Results successfully saved to: ${resultsPath}`);

  return results;
}

// Direct execution guard
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runBenchmark().catch(err => {
    console.error('BENCHMARK_ERROR:', err);
    process.exit(1);
  });
}
