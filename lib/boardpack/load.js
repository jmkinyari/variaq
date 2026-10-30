import "server-only";
import db from "../db";
import { SECTIONS } from "./build";

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** Load a board pack scoped to a workspace, with JSON columns parsed. */
export async function loadPackView(wsId, id) {
  const p = await db.get("SELECT p.*, u.name created_by_name, a.name approved_by_name, b.name budget_name FROM board_packs p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users a ON a.id = p.approved_by LEFT JOIN budgets b ON b.id = p.budget_id WHERE p.id = ? AND p.workspace_id = ?", [id, wsId]);
  if (!p) return null;
  return { ...p, sections: parse(p.sections, SECTIONS.map(([k]) => k)), commentary: parse(p.commentary, {}), snapshot: parse(p.snapshot, null) };
}
