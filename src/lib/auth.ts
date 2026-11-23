import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "./db";

const COOKIE = "glacier_session";
const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET manquant ou trop court (32 caractères minimum).");
  return new TextEncoder().encode(s);
};

export async function hashPassword(p: string) { return bcrypt.hash(p, 12); }
export async function verifyPassword(p: string, h: string) { return bcrypt.compare(p, h); }

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
export async function destroySession() { (await cookies()).delete(COOKIE); }

export async function verifyToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, secret()); return typeof payload.sub === "string" ? payload.sub : null; }
  catch { return null; }
}
export async function currentUserId(): Promise<string | null> {
  return verifyToken((await cookies()).get(COOKIE)?.value);
}
export async function requireUser() {
  const id = await currentUserId();
  if (!id) redirect("/login");
  const user = await db.user.findUnique({ where: { id } });
  if (!user) redirect("/login");
  return user;
}
export const SESSION_COOKIE = COOKIE;
