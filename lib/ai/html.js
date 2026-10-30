// Allow-list HTML sanitiser for AI-generated reports, plus the report document template.
// Defence in depth: reports are also served with a no-script CSP and shown in a sandboxed iframe.
const TAGS = new Set(["h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "strong", "em", "b", "i", "u", "span", "div", "section", "article", "header", "footer", "small", "br", "hr", "blockquote", "figure", "figcaption", "sup", "sub", "mark", "code",
  "svg", "g", "rect", "line", "polyline", "polygon", "path", "circle", "ellipse", "text", "tspan", "title", "desc"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "form", "textarea", "select", "button", "input", "link", "meta", "base", "frame", "frameset", "audio", "video", "canvas", "math", "foreignobject", "head", "title-not-in-svg"]);
const ATTRS = new Set(["class", "style", "colspan", "rowspan", "scope", "align", "role", "aria-label", "aria-hidden", "lang",
  "viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "dx", "dy", "d", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "points", "cx", "cy", "r", "rx", "ry", "text-anchor", "dominant-baseline", "font-size", "font-weight", "transform", "opacity", "fill-opacity", "preserveaspectratio", "xmlns"]);
const VOID = new Set(["br", "hr", "col"]);

function cleanStyle(v) {
  const s = String(v).replace(/\/\*[\s\S]*?\*\//g, "");
  if (/(url\s*\(|expression|javascript:|@import|behavior|-moz-binding|position\s*:\s*fixed)/i.test(s)) return null;
  return s.replace(/[<>"]/g, "").slice(0, 600);
}
const escAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function sanitizeHtml(input) {
  let html = String(input || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!doctype[^>]*>/gi, "");
  // Remove dangerous elements together with their content.
  for (const t of DROP_WITH_CONTENT) html = html.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, "gi"), "").replace(new RegExp(`<${t}\\b[^>]*\\/?>`, "gi"), "");
  let out = "";
  let last = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index).replace(/</g, "&lt;");
    last = re.lastIndex;
    const [, close, rawTag, rawAttrs] = m;
    const tag = rawTag.toLowerCase();
    if (!TAGS.has(tag)) continue;
    if (close) { if (!VOID.has(tag)) out += `</${tag}>`; continue; }
    let attrs = "";
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
    let a;
    while ((a = ar.exec(rawAttrs))) {
      const name = a[1].toLowerCase();
      if (name.startsWith("on") || !ATTRS.has(name)) continue;
      let val = a[2] === undefined ? "" : a[2].replace(/^["']|["']$/g, "");
      if (/^\s*(javascript|data|vbscript):/i.test(val)) continue;
      if (name === "style") { val = cleanStyle(val); if (val === null) continue; }
      attrs += ` ${name === "viewbox" ? "viewBox" : name === "preserveaspectratio" ? "preserveAspectRatio" : name}="${escAttr(val.slice(0, 2000))}"`;
    }
    out += `<${tag}${attrs}${VOID.has(tag) ? " /" : ""}>`;
  }
  out += html.slice(last).replace(/</g, "&lt;");
  return out;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Wrap a sanitised report body in a self-contained, printable HTML document. */
function reportDocument({ title, company, period, generatedAt, model, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · ${esc(company)}</title>
<style>
:root{--ink:#29242d;--muted:#6b6370;--line:#e6e0e4;--accent:#70556f;--good:#3f7a55;--warn:#9a6a12;--bad:#a3403c;--soft:#f6f3f5}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:28px 20px 48px}
.top{border-bottom:2px solid var(--accent);padding-bottom:14px;margin-bottom:22px}
.brand{font:600 12px/1 system-ui;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{font:400 30px/1.15 Georgia,serif;margin:.35em 0 .2em}h2{font:400 22px/1.2 Georgia,serif;margin:1.6em 0 .5em;border-bottom:1px solid var(--line);padding-bottom:.25em}h3{font-size:16px;margin:1.2em 0 .4em}
.meta{color:var(--muted);font-size:13px}.ai{display:inline-block;margin-top:8px;padding:3px 9px;border-radius:99px;background:#efe7ee;color:var(--accent);font-size:12px}
table{width:100%;border-collapse:collapse;margin:.6em 0 1.2em;font-size:14px}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600}td.num,th.num,.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:.8em 0 1.2em}.kpi{border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.kpi .label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.kpi .value{font:400 22px Georgia,serif}
.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
.callout{border-left:4px solid var(--accent);background:var(--soft);padding:10px 14px;margin:1em 0;border-radius:0 8px 8px 0}
.callout.bad{border-color:var(--bad)}.callout.warn{border-color:var(--warn)}.callout.good{border-color:var(--good)}
.actions li{margin:.3em 0}svg{max-width:100%;height:auto}
.foot{margin-top:36px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media (max-width:600px){.wrap{padding:18px 14px}h1{font-size:24px}table{font-size:13px;display:block;overflow-x:auto}}
@media print{.wrap{max-width:none;padding:0}a{color:inherit}h2{break-after:avoid}table,figure,.kpi{break-inside:avoid}}
</style></head><body><div class="wrap">
<div class="top"><div class="brand">${esc(company)}</div><h1>${esc(title)}</h1>
<div class="meta">${period ? `${esc(period)} · ` : ""}Generated ${esc(generatedAt)}</div>
<span class="ai">AI-generated draft — review figures before relying on them</span></div>
${body}
<div class="foot">Prepared with Variaq AI (${esc(model || "Claude")}) from ${esc(company)}'s own ledger and module data. Figures come from the system's data at generation time; AI commentary can contain mistakes and does not constitute professional, tax or audit advice.</div>
</div></body></html>`;
}

module.exports = { sanitizeHtml, reportDocument, esc };
