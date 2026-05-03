import { verifyToken, type AuthPayload } from "./auth.js";
import { isBlacklisted } from "./tokenBlacklist.js";

type ReqLike = {
  headers: { authorization?: string };
};

export async function verifyAdminToken(req: ReqLike): Promise<AuthPayload | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload || payload.role !== "admin") return null;
  if (await isBlacklisted(token)) return null;
  return payload;
}
