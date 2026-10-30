// Creates .env.local (with freshly generated secrets) and the database tables. Safe to run more than once.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const envLocal = path.join(__dirname, "..", ".env.local");
if (!fs.existsSync(envLocal)) {
  let env = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  env = env.replace(/^VARIAQ_MASTER_KEY=.*$/m, `VARIAQ_MASTER_KEY="${crypto.randomBytes(32).toString("hex")}"`);
  fs.writeFileSync(envLocal, env, { mode: 0o600 });
  console.log("Created .env.local with a new VARIAQ_MASTER_KEY. Back this key up: without it, encrypted data can't be read.");
}
require("./load-env");
const db = require("../lib/db");
db.ensureSchema().then(() => {
  console.log(`Database ready (${process.env.DATABASE_URL || "file:data/variaq.db"}).`);
  console.log("Next: npm run seed   (optional demo data)   then   npm run dev");
}).catch((e) => { console.error(e); process.exit(1); });
