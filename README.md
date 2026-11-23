# TokenScalpel

**Cut AI coding-agent token spend by 77%–85%+ and crash-test LLMs before trusting them in production.**  
*Zero npm dependencies · Pure Node.js · Structural Outliner · `HMAS-DSL` 3-Tier Protocol · Variable-Model Evals (`E1–E4`).*  
**Technical Report (v1.1 · Zenodo DOI):** [10.5281/zenodo.24451422](https://doi.org/10.5281/zenodo.24451422)

> **Why TokenScalpel?** Auditing 261 real production coding-agent sessions (~54.4M input characters) revealed that **70.1% of token spend is not reasoning—it is `read_file` blindly dumping entire files into context**. Meanwhile, lightweight and 3B–8B models silently fail in production via **ontological overload loops**, **tool omission during warm dialogue**, and **same-model context contamination**. TokenScalpel gives engineering teams and model labs reproducible tools to fix both.

---

## 60-Second Quickstart

Requires **Node.js >= 20**. Zero `npm install`.

```bash
git clone https://github.com/victormunoz-sec/tokenscalpel.git
cd tokenscalpel

# 1. Outline any large file before reading it (-85% to -95% input tokens)
node src/outline.mjs src/outline.mjs

# 2. Read ONLY the exact function slice you need
node src/outline.mjs src/outline.mjs --slice 14:46

# 3. Run the reproducible Token-Diet benchmark
node bench/token-diet.mjs

# 4. Run the Variable-Model Crash-Test Suite (reference matrix or live Ollama)
node src/eval-models.mjs --reference
node src/eval-models.mjs --ollama qwen2.5-coder:3b
```

---

## Reproducible Benchmarks

### 1. Static Tool-Output Benchmark v1.1 (18 Verifiable Tasks across 3 Repositories)

Evaluated across 18 real-world engineering tasks on 3 diverse open-source codebases (`hebbmesh`, `Ext-Py-Bench`, `Ext-Py-VoiceAgent`) with **18/18 PASS (100% recall)**, measured using real OpenAI BPE tokenizer (`tiktoken` `cl100k_base`):

| Retrieval Strategy | BPE Tokens (`cl100k_base`) | Est. Tokens (`chars/4`) | Accuracy | Relative Reduction vs E1 |
|---|---:|---:|---:|---:|
| **E1 (Full Read / Baseline)** | 91,136 | 90,942 | 18/18 PASS | Base (0.0%) |
| **E2 (Grep + ±25L ranges, max 4 blocks/file)** | 37,310 | 34,509 | 18/18 PASS | **-59.1%** |
| **E3 (TokenScalpel `outline.mjs` + ranges)** | 20,577 | 19,115 | 18/18 PASS | **-77.4%** (-44.8% vs E2) |

#### Breakdown by Repository (BPE Tokens)
- **`hebbmesh`** (6 tasks): 56,335 (E1) -> 17,931 (E2, -68.2%) -> **8,115 (E3, -85.6%)**
- **`Ext-Py-Bench`** (third-party Python benchmark suite, 6 tasks): 14,649 (E1) -> 8,020 (E2, -45.3%) -> **4,782 (E3, -67.4%)**
- **`Ext-Py-VoiceAgent`** (third-party Python voice-agent runtime, 6 tasks): 20,152 (E1) -> 11,359 (E2, -43.6%) -> **7,680 (E3, -61.9%)**

#### Breakdown by Task Kind (BPE Tokens)
- **`known_symbol`** (9 tasks): 31,618 (E1) -> 17,337 (E2) -> **8,915 (E3, -71.8%)**. *(Empirical Rule R5: on targeted known symbols with localized occurrences like task VT-2, grep can slightly edge out outliner: 1,523 vs 1,627 tokens, -6.4%).*
- **`exploratory`** (9 tasks): 59,518 (E1) -> 19,973 (E2) -> **11,662 (E3, -80.4%)**.

### 2. Isolated `HMAS-DSL` Protocol Compression (10 Canonical Coordination Pairs)

Measured with real OpenAI BPE tokenizer (`cl100k_base`):
- **Verbose Human Prose:** 808 BPE tokens (775 `chars/4`)
- **Telegraphic `HMAS-DSL`:** 446 BPE tokens (288 `chars/4`)
- **Real Net Token Reduction:** **-44.8% real BPE reduction** (demonstrating that naïve `chars/4` heuristic overestimates savings at -62.8%).

### 3. Variable-Model Crash-Test Matrix (`E1–E4`)

| Model Tier | `E1` Ontological Load | `E2` Tool Autonomy (Warm Chat) | `E3` `HMAS-DSL` | `E4` Context Isolation | Safe HMAS Role |
|---|---|---|---|---|---|
| **SLM 3B–8B** (`north-mini`, `qwen2.5-coder:3b`) | **FAIL** (repetition loop) | **FAIL** | Partial (direct API) | N/A | L3 Atomic Worker Only |
| **Fast / Flash** (`Flash-Lite`, `DeepSeek Flash`) | PASS (flat tone) | **FAIL** (omits save tool) | **PASS** | Sensitive | L3 + Bounded L2 |
| **Frontier** (`Sonnet`, `Neon`, `Hydrogen`, `Inkling`) | **PASS** (rich) | **PASS** | **PASS** | **High** (isolated) | L1 Coordinator + Full L2 |

---

## How to Use TokenScalpel in Your Daily Workflow

1. **In Claude Code / OpenCode / Cursor / Antigravity:**
   Add a single rule to your `CLAUDE.md` / `AGENTS.md`:
   > *"Never read files >400 lines whole. Run `node tokenscalpel/src/outline.mjs <file>` first, then slice exact line ranges."*
2. **In Multi-Agent Swarms:**
   Adopt [`spec/HMAS_DSL.md`](./spec/HMAS_DSL.md) to eliminate polite inter-agent chatter (`-44.8%` real BPE coordination tokens) and enforce `NW-THRESHOLD` so subagents only spawn when exploring >3 unknown files or writing >80 lines.
3. **For Model Labs & Local-LLM Builders:**
   Run `node src/eval-models.mjs --ollama <your-model>` to catch **ontological overload collapse (`E1`)** and **warm-dialogue tool omission (`E2`)** before shipping an agent harness.

---

## Security by Construction

Built for real production agent workflows with rigorous security engineering ([`SECURITY.md`](./SECURITY.md)):

- **Zero Supply-Chain Surface:** `0` external npm packages — pure native Node.js with zero hidden telemetry.
- **LLM Secret-Leak Denylist (`src/outline.mjs`):** Refuses by default to outline or slice `.env*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials.json`, `.npmrc`, `*.sqlite`, and `private_vault.md` so autonomous agents cannot accidentally dump credentials into LLM prompts (explicit `--allow-sensitive` override required).
- **Anti-Hallucination Evidence Gate:** Every delegated scout output under `HMAS-DSL` requires verifiable `file:line` citations before a specialist accepts or edits code.

---

## Sister Project & Dual Licensing

- **Memory Engine:** Check out [`hebbmesh`](https://github.com/victormunoz-sec/hebbmesh) — Zero-Bloat 4D Synaptic Memory over Markdown (DOI: [10.5281/zenodo.24451147](https://doi.org/10.5281/zenodo.24451147)).
- **License:** Dual-licensed under **GNU AGPL-3.0-or-later** ([`LICENSE`](./LICENSE)) and **Commercial License** ([`COMMERCIAL_LICENSE.md`](./COMMERCIAL_LICENSE.md)).
- **Turnkey Kit & Consulting:** Looking for **Iris Starter Kit** (pre-wired hooks + REM + Specialist Factory) or enterprise agent token audits & model evals? Contact **Victor Muñoz Jara** (Independent AI Systems & Security Researcher) at `victormunoz.research@gmail.com`.

---

## Citation

If you reference TokenScalpel, the static BPE tool-output benchmark, or `HMAS-DSL`, please cite the v1.1 Technical Report:

```bibtex
@techreport{munozjara2026tokenscalpel,
  author      = {Mu{\~n}oz Jara, Victor},
  title       = {Measuring Before Optimizing: A Production Telemetry Case Study, Static BPE Tool-Output Benchmark (outline vs. grep), and Wire-Format Compression (HMAS-DSL) for Coding Agents},
  institution = {Independent AI Systems \& Security Research},
  year        = {2026},
  month       = nov,
  version     = {1.1},
  doi         = {10.5281/zenodo.24451422},
  url         = {https://doi.org/10.5281/zenodo.24451422}
}
```
