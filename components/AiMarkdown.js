// Minimal, safe Markdown renderer for assistant answers: builds React elements (never raw HTML).
// Supports headings, paragraphs, bullet/numbered lists, tables, bold, italics and inline code.
import { Fragment } from "react";

function inline(text, keyBase) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_\s][^_]*_|\*[^*\s][^*]*\*)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function AiMarkdown({ text }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(line); i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      const numeric = (c) => /^[-−(]?[A-Z]{0,3}\s?[\d,.]+%?\)?$/.test(c);
      blocks.push(<div className="table-wrap ai-table" key={i}><table><thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `h${i}${j}`)}</th>)}</tr></thead>
        <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className={numeric(c) ? "num" : ""}>{inline(c, `c${i}${ri}${j}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push(<p className="ai-h" key={i}>{inline(h[2], `t${i}`)}</p>); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={i}>{items.map((t, j) => <li key={j}>{inline(t, `l${i}${j}`)}</li>)}</L>);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s|^\s*([-*•]|\d+[.)])\s+|^\s*\|/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={i}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${i}${j}`)}</Fragment>)}</p>);
  }
  return <div className="ai-md">{blocks}</div>;
}
