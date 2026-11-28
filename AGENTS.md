# TokenScalpel — Repository Agent Guidelines

Zero-dependency coding-agent token-diet toolkit and LLM crash-test suite (`v1.2.0`). Pure Node.js (`>= 20`), **0 npm dependencies**, **0 hidden telemetry**.

## Core CLI Commands
- Outline file symbols + exact `[line, endLine]`: `node src/outline.mjs <file>`
- Slice exact symbol or line range: `node src/outline.mjs <file> --slice <symbol|start:end>`
- Outline only symbols changed in `git diff`: `node src/outline.mjs <file> --diff`
- Find symbol definitions/usages (max 35): `node src/outline.mjs --refs <symbol> [dir]`
- Compress noisy CLI/test output (Delta Mode): `node src/shell-diet.mjs [--dsl] -- <command>`

## Tests, Benchmarks & Evals
- Unit test suite (8/8 PASS required): `npm test` (`node --test test/tokenscalpel.test.mjs`)
- Reproducible BPE token-diet benchmark: `npm run bench` (`node bench/token-diet.mjs`)
- Variable-model crash-test matrix: `npm run eval` (reference) or `npm run eval:ollama`

## Security & Architecture Constraints
- **Secret-Leak Denylist (`F-02` in `src/outline.mjs`):** Keep `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.kdbx`, `*.sqlite`, `*.db`, `id_rsa`, `id_ed25519`, `credentials.json`, `.npmrc`, and `private_vault.md` blocked by default. Never weaken `SENSITIVE_DENY_PATTERNS` or pass `--allow-sensitive` automatically.
- **Evidence Gate (`spec/HMAS_DSL.md`):** Delegated scout reports must include verifiable `file:line` citations before edits are accepted.
- **Zero-Bloat Rule:** Do not add external npm packages or network telemetry.
- **Benchmark Integrity:** Do not hand-edit `bench/results_*.json`; update only via benchmark runs.

## Drop-In Integrations
End-user integration templates live in `integrations/` (`agent-rules.md`, `claude-settings.example.json`, `antigravity-hooks.example.json`). Keep them strictly additive and non-overwriting.
