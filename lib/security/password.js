// Password policy (NIST 800-63B style: length over composition rules, block common passwords).
const COMMON = new Set(["password", "password1", "password123", "123456789012", "qwertyuiop", "letmein123", "iloveyou123", "welcome123", "admin123456", "changeme123", "kenya2024", "kenya2025", "kenya2026", "nairobi123", "safaricom123", "mpesa12345", "111111111111", "000000000000", "abc123456789", "passw0rd1234"]);

function checkPassword(pw, { email = "", name = "" } = {}) {
  const p = String(pw || "");
  if (p.length < 12) return "Use a password of at least 12 characters. A short phrase works well.";
  if (p.length > 200) return "That password is too long.";
  if (COMMON.has(p.toLowerCase())) return "That password is too common. Choose something less predictable.";
  if (/^(.)\1+$/.test(p)) return "Don't use a single repeated character.";
  const local = String(email).split("@")[0].toLowerCase();
  if (local.length >= 4 && p.toLowerCase().includes(local)) return "Don't include your email address in your password.";
  if (name && name.length >= 4 && p.toLowerCase().includes(name.toLowerCase().split(" ")[0])) return "Don't include your name in your password.";
  if (new Set(p).size < 5) return "Use a wider mix of characters.";
  return null;
}

module.exports = { checkPassword };
