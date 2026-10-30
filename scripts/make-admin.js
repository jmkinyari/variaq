// Grant or revoke Variaq system-administrator access (the /admin console).
// Usage:  npm run make-admin -- someone@company.com        (grant)
//         npm run make-admin -- someone@company.com --revoke
// The person must already have an account. Admins must turn on two-step verification to use /admin.
require("./load-env");
const db = require("../lib/db");

(async () => {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email || !email.includes("@")) { console.error("Usage: npm run make-admin -- <email> [--revoke]"); process.exit(1); }
  await db.ensureSchema();
  const u = await db.get("SELECT id, name FROM users WHERE email = ?", [email]);
  if (!u) { console.error(`No account for ${email}. Ask them to sign up first.`); process.exit(1); }
  await db.batch([
    { sql: "UPDATE users SET is_platform_admin = ? WHERE id = ?", args: [revoke ? 0 : 1, u.id] },
    { sql: "INSERT INTO platform_audit (id, user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)", args: [db.id(), null, revoke ? "admin.revoked" : "admin.granted", u.id, JSON.stringify({ email, via: "cli" }), "cli", db.now()] },
  ]);
  console.log(`${u.name} <${email}> ${revoke ? "is no longer" : "is now"} a Variaq system administrator.`);
})().catch((e) => { console.error(e); process.exit(1); });
