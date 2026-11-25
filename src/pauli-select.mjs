/**
 * TokenScalpel Pauli Slice Selector (`src/pauli-select.mjs`) — 0 external dependencies
 *
 * Applies a greedy Pauli Exclusion Principle over candidate code slices:
 *  - Pos 1 selects the highest `baseScore` candidate.
 *  - Pos 2..K (up to `maxSlices` or `maxTokens` budget) penalize redundant coverage
 *    of tokens/symbols already present in previously chosen slices (`coveredRatio * gamma`)
 *    and reward marginal IDF-weighted token coverage + file diversity (`fileDiversityBonus`).
 */

function tokenize(text) {
  if (!text) return [];
  const rawTokens = String(text).match(/[A-Za-z0-9_]{2,}/g) || [];
  const out = new Set();
  for (const tok of rawTokens) {
    out.add(tok.toLowerCase());
    // Split camelCase and snake_case sub-tokens for finer semantic overlap detection
    const parts = tok
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[_\s]+/);
    for (const p of parts) {
      if (p.length >= 2) out.add(p.toLowerCase());
    }
  }
  return Array.from(out);
}

function estimateTokens(text) {
  return Math.max(1, Math.round(String(text || '').length / 4));
}

/**
 * Select non-redundant, high-signal slices under a slice/token budget.
 *
 * @param {Array<{file:string, startLine:number, endLine:number, text:string, baseScore:number, symbol?:string}>} candidates
 * @param {string[]} [queryTerms=[]]
 * @param {object} [options={}]
 * @returns {Array}
 */
export function selectPauliSlices(candidates, queryTerms = [], options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const maxSlices = options.maxSlices ?? 6;
  const maxTokens = options.maxTokens ?? 2500;
  const gamma = options.gamma ?? 0.7;
  const fileDiversityBonus = options.fileDiversityBonus ?? 0.25;

  if (maxSlices <= 0 || maxTokens <= 0) return [];

  const queryTokenSet = new Set();
  for (const qt of queryTerms || []) {
    for (const t of tokenize(qt)) queryTokenSet.add(t);
  }

  // Precompute token sets and document frequency for IDF
  const df = new Map();
  const prepared = candidates.map((c, idx) => {
    const tokens = new Set(tokenize(`${c.text || ''} ${c.symbol || ''}`));
    for (const t of tokens) {
      df.set(t, (df.get(t) || 0) + 1);
    }
    return {
      raw: c,
      idx,
      file: c.file || '',
      symbol: c.symbol || '',
      baseScore: Number(c.baseScore) || 0,
      tokens,
      estTokens: estimateTokens(c.text),
    };
  });

  const N = prepared.length;
  const idf = new Map();
  for (const [t, freq] of df.entries()) {
    idf.set(t, Math.log(1 + N / (1 + freq)));
  }

  const maxBase = Math.max(...prepared.map((p) => p.baseScore), 0);

  // Deterministic Pos 1: highest baseScore (tie-break by file, startLine, original index)
  const sortedForPos1 = [...prepared].sort(
    (a, b) =>
      b.baseScore - a.baseScore ||
      a.file.localeCompare(b.file) ||
      (a.raw.startLine || 0) - (b.raw.startLine || 0) ||
      a.idx - b.idx
  );

  const first = sortedForPos1[0];
  const chosen = [{ ...first.raw, pauliRank: 1, pauliScore: first.baseScore, estTokens: first.estTokens }];
  const chosenIndices = new Set([first.idx]);
  const selectedFiles = new Set([first.file]);
  const coveredTokens = new Set(first.tokens);
  const coveredSymbols = new Set(first.symbol ? [first.symbol] : []);
  let usedTokens = first.estTokens;

  while (chosen.length < maxSlices) {
    const remaining = prepared.filter(
      (p) => !chosenIndices.has(p.idx) && usedTokens + p.estTokens <= maxTokens
    );
    if (remaining.length === 0) break;

    // Compute raw marginal IDF gains so we can normalize cleanly
    const scored = remaining.map((p) => {
      let overlapCount = 0;
      let marginalIdf = 0;
      let maxPossibleIdf = 0;

      for (const t of p.tokens) {
        const w = (idf.get(t) || 0) * (queryTokenSet.has(t) ? 2.5 : 1.0);
        maxPossibleIdf += w;
        if (coveredTokens.has(t)) {
          overlapCount++;
        } else {
          marginalIdf += w;
        }
      }

      let coveredRatio = p.tokens.size > 0 ? overlapCount / p.tokens.size : 0;
      if (p.symbol && coveredSymbols.has(p.symbol)) {
        coveredRatio = Math.min(1, coveredRatio + 0.35);
      }

      const normMarginal = maxPossibleIdf > 0 ? marginalIdf / maxPossibleIdf : 0;
      const normBase = maxBase > 0 ? p.baseScore / maxBase : 0;
      const divBonus = selectedFiles.has(p.file) ? 0 : fileDiversityBonus;

      const pauliScore = normBase + normMarginal + divBonus - gamma * coveredRatio;
      return { p, pauliScore };
    });

    scored.sort(
      (a, b) =>
        b.pauliScore - a.pauliScore ||
        b.p.baseScore - a.p.baseScore ||
        a.p.file.localeCompare(b.p.file) ||
        (a.p.raw.startLine || 0) - (b.p.raw.startLine || 0)
    );

    const best = scored[0];
    chosen.push({
      ...best.p.raw,
      pauliRank: chosen.length + 1,
      pauliScore: Math.round(best.pauliScore * 10000) / 10000,
      estTokens: best.p.estTokens,
    });
    chosenIndices.add(best.p.idx);
    selectedFiles.add(best.p.file);
    for (const t of best.p.tokens) coveredTokens.add(t);
    if (best.p.symbol) coveredSymbols.add(best.p.symbol);
    usedTokens += best.p.estTokens;
  }

  return chosen;
}
