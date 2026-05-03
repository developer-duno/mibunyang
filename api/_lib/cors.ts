// CORS 허용 Origin (프로덕션 + Vercel 프리뷰 + 로컬)
const ALLOWED_ORIGINS = [
  /^https:\/\/mibunyang[.-].*\.vercel\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

type ReqLike = {
  headers: { origin?: string };
  method?: string;
};

type ResLike = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { end: () => void };
};

type CorsOptions = {
  methods?: string;
  maxAge?: number;
};

/** 요청 Origin이 허용 목록에 있으면 반환, 아니면 null */
export function getAllowedOrigin(req: ReqLike): string | null {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.some(p => p.test(origin))) return origin;
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return origin;
  return null;
}

/**
 * CORS Origin 헤더 설정 + OPTIONS preflight 처리.
 * @returns true면 preflight 처리 완료 (caller는 즉시 return)
 */
export function handleCors(req: ReqLike, res: ResLike, options: CorsOptions = {}): boolean {
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
