"use server";
import db from "@/lib/db";

const TOPICS = { demo: "Demo request", sales: "Pricing & billing", hosting: "Hosting", security: "Security review", partner: "Partnership", support: "Support", other: "Other" };
const PLANS = { variaq: "Variaq ($40/mo, 5 users)" };

export async function sendContact(prev, formData) {
  const name = String(formData.get("name") || "").trim().slice(0, 200);
  const email = String(formData.get("email") || "").trim().slice(0, 320);
  const company = String(formData.get("company") || "").trim().slice(0, 200);
  const message = String(formData.get("message") || "").trim();
  const topic = TOPICS[String(formData.get("topic") || "")] || null;
  const plan = PLANS[String(formData.get("plan") || "")] || null;
  if (formData.get("website")) return { ok: true }; // honeypot
  if (!name || !email || !message) return { error: "Please fill in your name, email and message." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Please enter a valid email address." };
  if (message.length > 5000) return { error: "Please keep your message under 5,000 characters." };
  // Topic and plan are stored as a short prefix so the existing contact_messages table needs no migration.
  const tag = [topic, plan && `${plan} plan`].filter(Boolean).join(" · ");
  const body = tag ? `[${tag}]\n${message}` : message;
  await db.run("INSERT INTO contact_messages (id, name, email, company, message, created_at) VALUES (?,?,?,?,?,?)", [db.id(), name, email, company || null, body, db.now()]);
  return { ok: true };
}
