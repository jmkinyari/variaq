"use server";
import { cookies } from "next/headers";
import db from "@/lib/db";
import { requireUser, verifyPassword, hashPassword, revokeOtherSessions } from "@/lib/auth";
import { back } from "@/lib/flash";
import { newSecret, verify, recoveryCodes } from "@/lib/security/totp";
import { sealGlobal, openGlobal, sha256 } from "@/lib/security/crypto";
import { checkPassword } from "@/lib/security/password";
import { hit } from "@/lib/security/rate-limit";

const PATH = "/app/account";
const PENDING = "nq_mfa_setup";

// Step 1: generate a secret and keep it (sealed) in a short-lived cookie until the user proves
// they've added it to an authenticator app.
export async function startMfa() {
  const user = await requireUser(PATH);
  if (user.mfaEnabled) back(PATH, { err: "Two-step verification is already on." });
  cookies().set(PENDING, sealGlobal("mfa-setup", newSecret()), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: PATH, maxAge: 600 });
  back(PATH);
}

export async function confirmMfa(formData) {
  const user = await requireUser(PATH);
  if (!hit("mfa", user.id).ok) back(PATH, { err: "Too many attempts. Wait a few minutes." });
  const secret = openGlobal("mfa-setup", cookies().get(PENDING)?.value);
  if (!secret) back(PATH, { err: "Setup expired. Start again." });
  const step = verify(secret, String(formData.get("code") || ""));
  if (step === null) back(PATH, { err: "That code didn't match. Check the time on your phone and try the next code." });
  const codes = recoveryCodes();
  await db.run("UPDATE users SET mfa_secret = ?, mfa_enabled = 1, mfa_last_step = ?, recovery_codes = ? WHERE id = ?", [sealGlobal("mfa", secret), step, JSON.stringify(codes.map((c) => sha256(c))), user.id]);
  cookies().delete(PENDING);
  // Recovery codes go to a sealed 2-minute cookie rather than the URL, so they never land in history or logs.
  cookies().set("nq_recovery", sealGlobal("recovery", codes.join(" ")), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: PATH, maxAge: 120 });
  back(PATH, { ok: "Two-step verification is on." });
}

export async function disableMfa(formData) {
  const user = await requireUser(PATH);
  const row = await db.get("SELECT password_hash FROM users WHERE id = ?", [user.id]);
  if (!(await verifyPassword(String(formData.get("password") || ""), row.password_hash))) back(PATH, { err: "Password is incorrect." });
  await db.run("UPDATE users SET mfa_secret = NULL, mfa_enabled = 0, recovery_codes = NULL WHERE id = ?", [user.id]);
  back(PATH, { ok: "Two-step verification is off." });
}

export async function changePassword(formData) {
  const user = await requireUser(PATH);
  const row = await db.get("SELECT password_hash FROM users WHERE id = ?", [user.id]);
  if (!(await verifyPassword(String(formData.get("current") || ""), row.password_hash))) back(PATH, { err: "Current password is incorrect." });
  const pw = String(formData.get("password") || "");
  const weak = checkPassword(pw, { email: user.email, name: user.name });
  if (weak) back(PATH, { err: weak });
  await db.run("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?", [await hashPassword(pw), db.now(), user.id]);
  await revokeOtherSessions(user.id);
  back(PATH, { ok: "Password changed. Other devices have been signed out." });
}

export async function signOutOthers() {
  const user = await requireUser(PATH);
  await revokeOtherSessions(user.id);
  back(PATH, { ok: "Signed out of all other sessions." });
}
