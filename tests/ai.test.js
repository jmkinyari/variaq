// AI report HTML sanitiser and document template (the security boundary for model-written HTML).
const test = require("node:test");
const assert = require("node:assert");
const { sanitizeHtml, reportDocument } = require("../lib/ai/html");

test("scripts, event handlers and dangerous elements are removed", () => {
  const dirty = `<h2 onclick="steal()">Summary</h2><script>alert(1)</script><p>Revenue <strong>up</strong></p>
    <img src="x" onerror="alert(2)"><iframe src="https://evil.example"></iframe><style>body{display:none}</style>
    <form action="https://evil.example"><input name="pin"></form><object data="x"></object><svg><foreignObject><div>x</div></foreignObject></svg>`;
  const out = sanitizeHtml(dirty);
  for (const bad of ["script", "onclick", "onerror", "<img", "iframe", "<style", "<form", "<input", "<object", "foreignObject", "alert("]) assert.ok(!out.includes(bad), `still contains ${bad}: ${out}`);
  assert.match(out, /<h2>Summary<\/h2>/);
  assert.match(out, /<strong>up<\/strong>/);
});

test("javascript: URLs and CSS url()/expression are stripped; safe styles survive", () => {
  const out = sanitizeHtml(`<a href="javascript:alert(1)">x</a><div style="background:url(https://track.example/p.gif)">a</div><div style="color:#a3403c;font-weight:600">b</div><span style="width:expression(alert(1))">c</span>`);
  assert.ok(!/javascript:|url\(|expression/i.test(out), out);
  assert.match(out, /<div style="color:#a3403c;font-weight:600">b<\/div>/);
  assert.ok(!out.includes("<a"), "links are not in the allow-list");
});

test("tables, classes and inline SVG charts are preserved", () => {
  const html = `<div class="kpis"><div class="kpi"><div class="label">Revenue</div><div class="value">KES 6.0M</div></div></div>
    <table><thead><tr><th>Account</th><th class="num">Amount</th></tr></thead><tbody><tr><td colspan="1">4000 Sales</td><td class="num">6,018,700</td></tr></tbody></table>
    <svg viewBox="0 0 100 40" role="img" aria-label="Trend"><polyline points="0,30 50,10 100,20" fill="none" stroke="#70556f" stroke-width="2"/><text x="2" y="38" font-size="6">Jan</text></svg>`;
  const out = sanitizeHtml(html);
  assert.match(out, /<div class="kpis">/);
  assert.match(out, /<td class="num">6,018,700<\/td>/);
  assert.match(out, /<svg viewBox="0 0 100 40" role="img" aria-label="Trend">/);
  assert.match(out, /<polyline points="0,30 50,10 100,20" fill="none" stroke="#70556f" stroke-width="2"/);
});

test("stray angle brackets and comments can't smuggle markup", () => {
  const out = sanitizeHtml(`<!-- <script>x</script> --><p>1 < 2 and <<script>script>alert(1)</script></p><SCRIPT SRC=//evil.example></SCRIPT>`);
  assert.ok(!/<script/i.test(out), out);
  assert.match(out, /1 &lt; 2/);
});

test("report document escapes metadata and labels the content as AI-generated", () => {
  const doc = reportDocument({ title: "Q2 <script>", company: "Demo & Co", period: "2026-04-01 – 2026-04-30", generatedAt: "29 Oct 2026", model: "claude-opus-5-5", body: "<p>ok</p>" });
  assert.ok(!doc.includes("<script>"));
  assert.match(doc, /Q2 &lt;script&gt;/);
  assert.match(doc, /Demo &amp; Co/);
  assert.match(doc, /AI-generated draft/);
  assert.ok(!/<script/i.test(doc));
});
