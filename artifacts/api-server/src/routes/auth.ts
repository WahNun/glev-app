import { Router } from "express";
import { db, membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

const SALT = "glev-members-v1";

function hashPassword(password: string): string {
  return crypto.pbkdf2Sync(password, SALT, 100_000, 64, "sha512").toString("hex");
}

function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

router.post("/auth/signup", async (req, res): Promise<void> => {
  const { name, email, password } = req.body ?? {};
  if (!email || typeof email !== "string" || !isValidEmail(email)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  const existing = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.email, email.toLowerCase()));

  if (existing.length > 0) {
    res.status(409).json({ error: "This email is already registered." });
    return;
  }

  const passwordHash = hashPassword(password);
  const [member] = await db
    .insert(membersTable)
    .values({ name: name || null, email: email.toLowerCase(), passwordHash })
    .returning({ id: membersTable.id, email: membersTable.email, name: membersTable.name });

  res.status(201).json({ ok: true, member: { id: member.id, email: member.email, name: member.name } });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || typeof email !== "string" || !isValidEmail(email)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Password is required." });
    return;
  }

  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.email, email.toLowerCase()));

  if (!member || hashPassword(password) !== member.passwordHash) {
    res.status(401).json({ error: "Incorrect email or password." });
    return;
  }

  res.json({ ok: true, member: { id: member.id, email: member.email, name: member.name } });
});

export default router;
