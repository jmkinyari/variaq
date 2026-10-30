// Flux (variance) analysis: compares account movements between two periods and
// explains material changes using the linked transactions. Rule-based, not AI.

function inRange(d, a, b) { return d >= a && d <= b; }

/**
 * entries: [{id,date,description,reference,accountCode,accountName,amountCents,counterparty}]
 * Returns { lines: [...], totals, generatedAt }
 */
function computeFlux(entries, { baseStart, baseEnd, compStart, compEnd, thresholdPct = 10, thresholdCents = 5000000 }) {
  const accts = new Map();
  for (const e of entries) {
    const inBase = inRange(e.date, baseStart, baseEnd);
    const inComp = inRange(e.date, compStart, compEnd);
    if (!inBase && !inComp) continue;
    if (!accts.has(e.accountCode)) accts.set(e.accountCode, { accountCode: e.accountCode, accountName: e.accountName || "", base: 0, comp: 0, baseCount: 0, compCount: 0, compEntries: [], byCp: new Map() });
    const a = accts.get(e.accountCode);
    if (!a.accountName && e.accountName) a.accountName = e.accountName;
    const cp = (e.counterparty || e.description || "Other").trim();
    if (!a.byCp.has(cp)) a.byCp.set(cp, { name: cp, base: 0, comp: 0 });
    if (inBase) { a.base += e.amountCents; a.baseCount++; a.byCp.get(cp).base += e.amountCents; }
    if (inComp) { a.comp += e.amountCents; a.compCount++; a.compEntries.push(e); a.byCp.get(cp).comp += e.amountCents; }
  }
  const lines = [];
  for (const a of accts.values()) {
    const change = a.comp - a.base;
    const pct = a.base === 0 ? (a.comp === 0 ? 0 : null) : Math.round((change / Math.abs(a.base)) * 1000) / 10;
    const material = Math.abs(change) >= thresholdCents && (pct === null || Math.abs(pct) >= thresholdPct);
    const drivers = [...a.byCp.values()]
      .map((c) => ({ ...c, change: c.comp - c.base }))
      .filter((c) => c.change !== 0)
      .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
      .slice(0, 3);
    const topEntries = [...a.compEntries].sort((x, y) => Math.abs(y.amountCents) - Math.abs(x.amountCents)).slice(0, 5)
      .map((e) => ({ id: e.id, date: e.date, description: e.description, reference: e.reference, counterparty: e.counterparty, amountCents: e.amountCents }));
    lines.push({ accountCode: a.accountCode, accountName: a.accountName, base: a.base, comp: a.comp, change, pct, material, baseCount: a.baseCount, compCount: a.compCount, drivers, topEntries, explanation: explain(a, change, pct, drivers) });
  }
  lines.sort((x, y) => (y.material - x.material) || Math.abs(y.change) - Math.abs(x.change));
  return {
    lines,
    totals: { accounts: lines.length, material: lines.filter((l) => l.material).length },
    generatedAt: new Date().toISOString(),
  };
}

function money(c) { return `KES ${(Math.abs(c) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`; }

function explain(a, change, pct, drivers) {
  if (change === 0) return "No change between the two periods.";
  const dir = change > 0 ? "increased" : "decreased";
  let s = `Net movement ${dir} by ${money(change)}${pct === null ? " (no activity in the base period)" : ` (${pct > 0 ? "+" : ""}${pct}%)`}; ${a.compCount} entr${a.compCount === 1 ? "y" : "ies"} this period vs ${a.baseCount} before.`;
  if (drivers.length) {
    const parts = drivers.map((d) => `${d.name} (${d.change > 0 ? "+" : "−"}${money(d.change)}${d.base === 0 ? ", new" : d.comp === 0 ? ", none this period" : ""})`);
    s += ` Largest drivers: ${parts.join("; ")}.`;
  }
  return s;
}

module.exports = { computeFlux };
