# Security Policy — TokenScalpel

**Maintainer:** Victor Muñoz Jara (Independent AI Systems & Security Researcher)

## 1. Trust Boundary & Zero-Supply-Chain Posture
- **Zero External Dependencies (`0` npm packages):** Built strictly on native Node.js (`fs`, `path`, `fetch`), eliminating npm supply-chain attack vectors.
- **Local-First Execution:** `outline.mjs` and `bench/token-diet.mjs` perform zero network calls. `eval-models.mjs --ollama` connects strictly to local `127.0.0.1:11434`.

## 2. LLM Context-Leak Prevention (Sensitive File Denylist)
Coding agents frequently leak secrets into third-party LLM prompts when granted unrestricted file-reading utilities. By default, `src/outline.mjs` blocks reading and slicing sensitive files:
- `.env` and `.env.*`
- Private keys & binary stores: `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.kdbx`, `*.sqlite`, `*.db`
- Credential files: `id_rsa`, `id_ed25519`, `credentials.json`, `.npmrc`, `private_vault.md`

Access requires an explicit human override (`--allow-sensitive`).

## 3. Coordinated Vulnerability Disclosure (CVD) & SLA
Please **do not** disclose 0-days via public issues.
- **Private Reporting:** Use GitHub Private Vulnerability Reporting or email `victormunoz.research@gmail.com` with subject `[SECURITY][TokenScalpel]`.
- **Response SLA:** Acknowledgement `< 24h` · CVSS v3.1 triage `< 72h` · Patch target `< 7 days`.

## 4. Scope & Safe Harbor
Good-faith security research against `v1.0.x` is covered by Safe Harbor.
- **In-Scope:** Denylist bypasses in `src/outline.mjs`, command injection, or unintended network egress.
- **Out-of-Scope:** Intentional human use of `--allow-sensitive` or self-DoS on local files.
