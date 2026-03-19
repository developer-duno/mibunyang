// CORS 허용 Origin (프로덕션 + Vercel 프리뷰 + 로컬)
const ALLOWED_ORIGINS = [
  /^https:\/\/mibunyang[.-].*\.vercel\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

/** 요청 Origin이 허용 목록에 있으면 반환, 아니면 null */
export function getAllowedOrigin(req) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.some(p => p.test(origin))) return origin;
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return origin;
  return null;
}

/**
 * CORS Origin 헤더 설정 + OPTIONS preflight 처리.
 * @param {object} req
 * @param {object} res
 * @param {{ methods?: string, maxAge?: number }} [options]
 * @returns {boolean} true면 preflight 처리 완료 (caller는 즉시 return)
 */
export function handleCors(req, res, options = {}) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);

  if (req.method === "OPTIONS") {
    if (options.methods) res.setHeader("Access-Control-Allow-Methods", options.methods);
    if (options.methods) res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (options.maxAge) res.setHeader("Access-Control-Max-Age", String(options.maxAge));
    res.status(204).end();
    return true;
  }
  return false;
}
