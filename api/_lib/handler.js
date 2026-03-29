import { handleCors } from "./cors.js";
import { checkRateLimit } from "./rateLimit.js";
import { verifyAdminToken } from "./adminAuth.js";

/**
 * API 핸들러 래퍼 — CORS, Method, RateLimit, Admin Auth 통합 처리.
 * config에 명시한 항목만 적용, 생략하면 해당 미들웨어 스킵.
 *
 * @param {object} config
 * @param {string|string[]}  config.method    - 허용 HTTP 메서드. "GET", "POST", ["GET","POST"]
 * @param {object}           [config.cors]    - handleCors 옵션. {} = 기본 CORS 적용, 생략 = CORS 미적용
 *                                              { maxAge: 86400 } 등 추가 옵션 가능
 * @param {string}           [config.rateLimit] - checkRateLimit 엔드포인트 키 (e.g. "login"). 생략 = 미적용
 * @param {boolean}          [config.admin]   - true면 verifyAdminToken 필수. 생략 = 미적용
 * @param {Function|Object}  config.handler   - 비즈니스 로직 함수 또는 { GET, POST } 메서드별 객체
 * @returns {Function} Vercel Serverless 호환 async handler (req, res) => void
 */
export function withHandler(config) {
  const methods = Array.isArray(config.method) ? config.method : [config.method];

  return async function handler(req, res) {
    // 1. CORS (config.cors 존재 시에만)
    if (config.cors) {
      const corsOpts = { methods: [...methods, "OPTIONS"].join(", "), ...config.cors };
      if (handleCors(req, res, corsOpts)) return;
    }

    // 2. Method check
    if (!methods.includes(req.method)) {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // 3. Rate limit (config.rateLimit 존재 시에만)
    if (config.rateLimit) {
      const { limited, retryAfter } = await checkRateLimit(req, config.rateLimit);
      if (limited) {
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
          ok: false,
          error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.`,
        });
      }
    }

    // 4. Admin auth (config.admin === true 시에만)
    if (config.admin && !verifyAdminToken(req)) {
      return res.status(401).json({ ok: false, error: "관리자 인증이 필요합니다" });
    }

    // 5. Dispatch — 함수 또는 { GET, POST } 객체
    if (typeof config.handler === "function") return config.handler(req, res);
    const methodHandler = config.handler[req.method];
    if (methodHandler) return methodHandler(req, res);
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  };
}
