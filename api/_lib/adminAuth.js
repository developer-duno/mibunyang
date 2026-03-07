import { verifyToken } from "./auth.js";

export function verifyAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = verifyToken(auth.slice(7));
  if (!payload || payload.role !== "admin") return null;
  return payload;
}
