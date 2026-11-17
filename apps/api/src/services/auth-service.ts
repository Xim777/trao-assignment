import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SessionModel, UserModel } from "../models/index.js";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function derivePasswordHash(password: string, salt: string): Promise<Buffer> {
  return await scrypt(password, salt, 64) as Buffer;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await derivePasswordHash(password, salt);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const actual = await derivePasswordHash(password, salt);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createUserSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await SessionModel.create({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt
  });

  return { token, expiresAt };
}

export async function findUserForSession(token: string): Promise<{ id: string; email: string } | null> {
  const session = await SessionModel.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() }
  }).populate("userId").exec();

  if (!session || !session.userId || typeof session.userId !== "object" || !("email" in session.userId)) {
    return null;
  }

  const user = session.userId as unknown as { _id: { toString(): string }; email: string };
  return { id: user._id.toString(), email: user.email };
}

export async function revokeUserSession(token: string): Promise<void> {
  await SessionModel.deleteOne({ tokenHash: hashSessionToken(token) });
}

export async function registerUser(email: string, password: string): Promise<{ id: string; email: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await UserModel.exists({ email: normalizedEmail });

  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  const user = await UserModel.create({
    email: normalizedEmail,
    passwordHash: await hashPassword(password)
  });

  return { id: user.id, email: user.email };
}

export async function authenticateUser(email: string, password: string): Promise<{ id: string; email: string } | null> {
  const user = await UserModel.findOne({
    email: email.trim().toLowerCase()
  }).select("+passwordHash").exec();

  if (!user || !await verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return { id: user.id, email: user.email };
}
