import { handleCors } from "./cors.js";
import { checkRateLimit } from "./rateLimit.js";
import { verifyAdminToken } from "./adminAuth.js";

/**
 * Vercel Serverless Function 의 req/res 간이 타입.
 * `@vercel/node` 미설치 환경에서 사용 (M2 범위 내 devDep 추가 결정 미정).
 */
type ReqLike = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  [key: string]: unknown;
};

type ResLike = {
  setHeader: (_name: string, _value: string) => void;
  status: (_code: number) => ResLike;
  json: (_body: unknown) => unknown;
  end: () => unknown;
  [key: string]: unknown;
};

type HandlerFn = (_req: ReqLike, _res: ResLike) => Promise<unknown> | unknown;

type MethodHandler = HandlerFn | { [method: string]: HandlerFn };

type WithHandlerConfig = {
  /** 허용 HTTP 메서드. "GET", "POST", ["GET","POST"] */
  method: string | string[];
  /** handleCors 옵션. {} = 기본 CORS 적용, 생략 = CORS 미적용 */
  cors?: { methods?: string; maxAge?: number };
  /** checkRateLimit 엔드포인트 키 (e.g. "login"). 생략 = 미적용 */
  rateLimit?: string;
  /** true면 verifyAdminToken 필수. 생략 = 미적용 */
  admin?: boolean;
  /** 비즈니스 로직 함수 또는 { GET, POST } 메서드별 객체 */
  handler: MethodHandler;
};

/**
 * API 핸들러 래퍼 — CORS, Method, RateLimit, Admin Auth 통합 처리.
 * config에 명시한 항목만 적용, 생략하면 해당 미들웨어 스킵.
 *
 * 미들웨어 순서: CORS → Method(405) → RateLimit(429) → Admin(401) → Dispatch
 */
export function withHandler(config: WithHandlerConfig): HandlerFn {
  const methods = Array.isArray(config.method) ? config.method : [config.method];

  return async function handler(req: ReqLike, res: ResLike): Promise<unknown> {
    // 1. CORS (config.cors 존재 시에만)
    if (config.cors) {
      const corsOpts = { methods: [...methods, "OPTIONS"].join(", "), ...config.cors };
      if (handleCors(req, res, corsOpts)) return;
    }

    // 2. Method check
    if (!req.method || !methods.includes(req.method)) {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // 3. Rate limit (config.rateLimit 존재 시에만)
    if (config.rateLimit) {
      const result = await checkRateLimit(req, config.rateLimit);
      if (result.limited) {
        res.setHeader("Retry-After", String(result.retryAfter));
        return res.status(429).json({
          ok: false,
          error: `요청이 너무 많습니다. ${result.retryAfter}초 후 다시 시도해주세요.`,
        });
      }
    }

    // 4. Admin auth (config.admin === true 시에만)
    if (config.admin && !(await verifyAdminToken(req))) {
      return res.status(401).json({ ok: false, error: "관리자 인증이 필요합니다" });
    }

    // 5. Dispatch — 함수 또는 { GET, POST } 객체
    if (typeof config.handler === "function") return config.handler(req, res);
    const methodHandler = config.handler[req.method];
    if (methodHandler) return methodHandler(req, res);
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  };
}
