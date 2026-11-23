# HMAS-DSL & 3-Tier Orchestration Specification (v1.0)

## 1. Topology: Thinker vs. Doer (Zero Flat-Swarm Chaos)
```text
  L1 · COORDINATOR (Human alignment, global memory, defines objective & scope; never edits product code)
        │  HMAS-DSL (zero prose)
        ▼
  L2 · DOMAIN SPECIALIST (Backend / Frontend / AppSec / Growth — writes // PLAN:, audits diffs & tests)
        ├── <= 2 located files & < 80 lines  ──► Direct surgical range edit in L2 (avoids worker startup cost)
        └── > 3 unknown files OR >= 80 lines ──► Spawns L3 Worker under NW-THRESHOLD
                                                      │
                                                      ▼
                                          L3 · ATOMIC WORKER (nw-scout / nw-coder)
                                          • Zero persona / zero philosophy (Proportional Ontological Load)
                                          • Must cite exact `file:line` evidence (Anti-Hallucination Gate)
                                          • Reports ONLY to L2 (silence toward L1); killed immediately after audit
```

## 2. `HMAS-DSL` Wire Protocol (45–65% Inter-Agent Token Reduction)
Natural language belongs exclusively to `Human <-> L1`. Between agents (`L1 <-> L2 <-> L3`), strip greetings, explanations, and filler:

- **`L1 -> L2`:** `ROLE:<role>|OBJ:<goal>|SCOPE:<paths>|NO_GIT|NW_POLICY:THRESHOLD|PROTO:HMAS_DSL|REPLY`
- **`L2 -> L3`:** `MODE:SCOUT|CODER|T#:<file>#L<range>-><op>|OUT:<file:line+evidence>|SILENCE:@coordinator`
- **`L3 -> L2`:** `T#:OK|ERR|<file>#L<line>|<evidence>`
- **`L2 -> L1`:** `AUDIT:PASS|FAIL|0_HALLUC|NW:killed(<id>)|skip(<reason>)|FILES:<file>#L<range>|DELTA:+<n>L/-<m>L`

## 3. Quantitative Delegation Firewall (`NW-THRESHOLD`)
- **Discovery (`> 3 files` without exact line numbers):** Mandatory delegation to `nw-scout` or structural outlining via `src/outline.mjs`.
- **Bulk Editing (`>= 3 files` or `> 80 new/repetitive lines`):** Mandatory delegation to `nw-coder`; L2 designs the contract and audits `git diff` + tests.
- **Surgical Edit (`<= 2 located files` and `< 80 lines`):** Forbidden to spawn a worker; L2 edits directly by line range.

## 4. Active Verbal Self-Critique Buffer (`L-REFLEXION`)
Maintain at most **10 active negative rules `[V]`** derived from real production mistakes, injected at session start. Audit weekly and archive internalized rules to `[S]` so system prompts never bloat.
