"use client";
export default function PrintButton() {
  return <button type="button" className="btn sm primary" onClick={() => window.print()}>Print / save as PDF</button>;
}
