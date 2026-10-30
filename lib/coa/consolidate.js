// Translate trial balances between charts and reconcile two charts against each other.

/**
 * Translate a TB into the target chart.
 * lines: [{code, name, balanceCents}]; mapping: Map(sourceCode -> targetCode); target: Map(code -> {name, cls})
 * Returns { rows: [{code, name, cls, balanceCents, sources:[{code,name,balanceCents}]}], unmapped: [...], totalCents }
 */
function translateTb(lines, mapping, target) {
  const rows = new Map(), unmapped = [];
  let total = 0;
  for (const l of lines) {
    total += l.balanceCents;
    const tc = mapping ? mapping.get(String(l.code)) : String(l.code);
    if (!tc) { if (l.balanceCents) unmapped.push(l); continue; }
    if (!rows.has(tc)) rows.set(tc, { code: tc, name: target.get(tc)?.name || l.name || "", cls: target.get(tc)?.cls || null, balanceCents: 0, sources: [] });
    const r = rows.get(tc);
    r.balanceCents += l.balanceCents;
    r.sources.push({ code: String(l.code), name: l.name || "", balanceCents: l.balanceCents });
  }
  return { rows: [...rows.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), unmapped, totalCents: total, unmappedCents: unmapped.reduce((a, l) => a + l.balanceCents, 0) };
}

/**
 * Compare two translated TBs (same target chart). a/b: [{code, name, balanceCents}].
 * Finds per-account differences and probable mispostings: two accounts whose differences are
 * equal and opposite (within tolerance) — the classic signature of a balance posted to the wrong
 * account in one system. Each comes with a proposed reclass journal.
 */
function reconcileCharts(a, b, { toleranceCents = 100, relTolerance = 0.005, names = new Map() } = {}) {
  const A = new Map(a.map((r) => [r.code, r])), B = new Map(b.map((r) => [r.code, r]));
  const codes = [...new Set([...A.keys(), ...B.keys()])].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const diffs = [];
  for (const c of codes) {
    const va = A.get(c)?.balanceCents || 0, vb = B.get(c)?.balanceCents || 0;
    const d = va - vb;
    diffs.push({ code: c, name: A.get(c)?.name || B.get(c)?.name || names.get(c) || "", aCents: va, bCents: vb, diffCents: d, matched: Math.abs(d) <= toleranceCents });
  }
  // Pair opposite differences greedily, largest first.
  const open = diffs.filter((d) => !d.matched).sort((x, y) => Math.abs(y.diffCents) - Math.abs(x.diffCents));
  const used = new Set(), mispostings = [];
  for (const d of open) {
    if (used.has(d.code)) continue;
    const tol = Math.max(toleranceCents, Math.abs(d.diffCents) * relTolerance);
    const partner = open.find((o) => !used.has(o.code) && o.code !== d.code && Math.sign(o.diffCents) === -Math.sign(d.diffCents) && Math.abs(Math.abs(o.diffCents) - Math.abs(d.diffCents)) <= tol);
    if (!partner) continue;
    used.add(d.code); used.add(partner.code);
    const amt = Math.abs(d.diffCents);
    // In system A, `over` has too much debit and `under` too little (relative to B).
    const over = d.diffCents > 0 ? d : partner, under = d.diffCents > 0 ? partner : d;
    mispostings.push({
      amountCents: amt, accounts: [over.code, under.code],
      explanation: `${over.code} ${over.name} is ${fmt(amt)} higher in A and ${under.code} ${under.name} is ${fmt(amt)} lower — consistent with an entry posted to ${over.code} that belongs in ${under.code} (or a mapping error).`,
      reclass: [
        { accountCode: under.code, accountName: under.name, description: `Reclass from ${over.code}`, debitCents: amt, creditCents: 0 },
        { accountCode: over.code, accountName: over.name, description: `Reclass to ${under.code}`, debitCents: 0, creditCents: amt },
      ],
    });
  }
  const unexplained = open.filter((d) => !used.has(d.code));
  return { diffs, mispostings, unexplained, totals: { aCents: a.reduce((s, r) => s + r.balanceCents, 0), bCents: b.reduce((s, r) => s + r.balanceCents, 0) } };
}
const fmt = (c) => (c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

module.exports = { translateTb, reconcileCharts };
