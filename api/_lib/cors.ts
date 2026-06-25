// CORS 허용 Origin.
// 프리뷰 정규식은 Vercel 배포 URL 패턴 `<project>-<hash>-<team-slug>.vercel.app` 에 맞춰
// 팀 슬러그(developer-dunos-projects)를 앵커링한다. 옛 `mibunyang[.-].*` 는 공격자가
// `mibunyang-evil.vercel.app`·`mibunyang.attacker.vercel.app` 같은 임의 프로젝트를
// vercel.app 에 무료 배포해 매칭 origin 을 만들 수 있어 좁혔다(세션 442 보안 감사 #5).
// 프로덕션 도메인(미분양아파트.com)·`mibunyang.vercel.app` 은 VERCEL_URL env 매칭으로 통과.
const PREVIEW_ORIGIN = /^https:\/\/mibunyang-[a-z0-9-]+-developer-dunos-projects\.vercel\.app$/;
// localhost 는 개발/프리뷰 환경에서만 허용(프로덕션 번들에서 제외, 세션 442 #6).
const LOCALHOST_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";
const ALLOWED_ORIGINS = IS_PRODUCTION ? [PREVIEW_ORIGIN] : [PREVIEW_ORIGIN, LOCALHOST_ORIGIN];

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
