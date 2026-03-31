# 리프레시 토큰 도입 검토

> 작성일: 2026-03-31 | 상태: 검토 완료 | 결론: 현상 유지 권고

## 1. 현재 인증 아키텍처

### 토큰 흐름

```
[로그인] → createToken(payload, {ttl}) → JWT (HS256)
                                           │
                ┌──────────────────────────┘
                ▼
[프론트] sessionStorage.setItem("expertToken", jwt)
                │
                ▼ (15분 주기 + visibilitychange)
[검증] POST /api/auth/verify
         → verifyToken(jwt)         // 서명 + 만료 확인
         → isBlacklisted(jwt)       // KV bl:{hash} 조회 (fail-open)
         → user.status 확인         // suspended/rejected → 403
                │
                ▼ (로그아웃 시)
[로그아웃] POST /api/auth/logout
         → blacklistToken(jwt)      // KV bl:{sha256} TTL=잔여만료
         → 프론트 sessionStorage 삭제
```

### 핵심 수치

| 항목 | 값 | 파일:줄 |
|------|-----|---------|
| Access TTL (전문가) | 24시간 | api/_lib/auth.js:35 |
| Access TTL (관리자) | 1시간 | api/auth/login.js:58 |
| JWT 알고리즘 | HMAC-SHA256 자체 구현 | api/_lib/auth.js:31 |
| 블랙리스트 | KV `bl:{sha256_32char}` | api/_lib/tokenBlacklist.js:5 |
| 블랙리스트 전략 | fail-open (Redis 장애 시 허용) | api/_lib/tokenBlacklist.js:24 |
| 검증 폴링 | 15분 + visibilitychange | useExpertMode.js |
| 토큰 저장소 | sessionStorage | useAdminMode.js:14 |
| Suspended 감지 지연 | 최대 15분 | verify 폴링 주기 |

## 2. 리프레시 토큰이 필요한 일반적 상황

| 상황 | 현재 해당 여부 |
|------|--------------|
| Access Token 짧게 유지 (5~15분) | X — 24시간 |
| 사용자 수 많아 토큰 탈취 위험 증가 | X — 전문가+관리자 소수 |
| 모바일 앱에서 장기 세션 유지 | X — 웹 SPA만 |
| SSO/OAuth 연동 | X — 자체 인증 |
| 즉시 토큰 무효화 필요 | △ — 블랙리스트로 대응 중 |

## 3. 아키텍처 옵션 비교

### 옵션 A: 현상 유지 + TTL 미세조정

변경 없음. 필요 시 전문가 TTL 24h → 12h 단축 검토.

| 항목 | 값 |
|------|-----|
| Access TTL | 전문가 24h(또는 12h), 관리자 1h |
| Refresh TTL | 없음 |
| 추가 KV 키 | 없음 |
| 코드 변경 | 0줄 (TTL 조정만 상수 1줄) |
| 복잡도 | 최소 |

### 옵션 B: KV 기반 Refresh Token

Access Token을 15분으로 단축, Refresh Token(7일)을 KV에 저장.

| 항목 | 값 |
|------|-----|
| Access TTL | 15분 |
| Refresh TTL | 7일 |
| 추가 KV 키 | `rt:{hash}` per user |
| 코드 변경 | ~200줄 (새 엔드포인트 + 프론트 자동 갱신) |
| 복잡도 | 중 |

**필요한 변경**:
- `POST /api/auth/refresh` 엔드포인트 신규
- `api/_lib/auth.js`에 refreshToken 생성/검증 로직
- 프론트: fetch 인터셉터에서 401 → refresh → 재시도 로직
- KV: `rt:{hash}` 키 + TTL 7일
- 로그아웃: access + refresh 모두 블랙리스트

### 옵션 C: Token Rotation (이중 토큰)

옵션 B + Refresh Token을 1회용으로 만들어 재사용 감지.

| 항목 | 값 |
|------|-----|
| Access TTL | 15분 |
| Refresh TTL | 7일 (1회용) |
| 추가 KV 키 | `rt:{hash}` + `rt_family:{id}` |
| 코드 변경 | ~350줄 |
| 복잡도 | 높음 |

**추가 필요**:
- token family 개념 (refresh 재사용 시 전체 family 무효화)
- 동시 요청 race condition 처리
- KV 트랜잭션 또는 낙관적 잠금

## 4. 보안 시나리오 분석

| 공격 | 옵션 A (현재) | 옵션 B | 옵션 C |
|------|-------------|--------|--------|
| Access 탈취 (XSS) | 24h 노출 | 15분 노출 | 15분 노출 |
| Refresh 탈취 | 해당 없음 | 7일 노출 | 재사용 시 감지 |
| 강제 로그아웃 | 블랙리스트 즉시 + 15분 폴링 | 블랙리스트 즉시 | 블랙리스트 즉시 |
| CSRF | sessionStorage 면역 | sessionStorage 면역 | sessionStorage 면역 |
| Redis 장애 | fail-open (TTL이 2차 방어) | fail-open + 15분 후 갱신 실패 | 더 복잡 |

**핵심 관찰**: XSS가 발생하면 옵션 B/C에서도 Refresh Token이 sessionStorage에 있으므로 탈취 가능. httpOnly cookie로 전환해야 진정한 보호가 되지만, SPA + Vercel Serverless 구조에서 cookie 관리는 추가 복잡도.

## 5. KV 비용 영향

| 항목 | 옵션 A | 옵션 B/C |
|------|--------|---------|
| KV 키 수 (per user) | 1 (bl:{hash} 로그아웃 시만) | 2 (bl:{hash} + rt:{hash}) |
| KV 읽기 (per request) | 1 (isBlacklisted) | 2 (isBlacklisted + refreshToken 검증) |
| Vercel KV 무료 한도 | 30,000 req/월 | 사용자 수 * 15분당 1회 * 30일 |

현재 사용자 수(~10명)에서는 무료 한도 내. 100명+ 시에도 KV 비용은 미미.

## 6. 최종 권고

### 권고: 옵션 A (현상 유지)

**근거**:
1. **사용자 수 극소** — 전문가 + 관리자 합산 10명 미만. 토큰 탈취 공격 표면 최소
2. **블랙리스트 + 폴링** — 강제 로그아웃(suspended) 15분 내 감지. 실질적 보안 충분
3. **복잡도 vs 이득** — 옵션 B는 ~200줄 추가 + fetch 인터셉터 + 새 엔드포인트. 현재 규모에서 과도
4. **sessionStorage** — httpOnly cookie가 아닌 한 refresh token도 XSS에 취약. 진정한 보안 향상 미미
5. **운영 비용** — KV 키 증가, 디버깅 복잡도 증가, race condition 처리 필요

### 재검토 조건

다음 조건 중 하나 이상 충족 시 옵션 B 재검토:
- 사용자 수 100명+ 도달
- 모바일 앱 출시 (장기 세션 필요)
- SSO/OAuth 연동 요구
- 보안 감사에서 Access TTL 단축 권고

### 선택적 개선 (현 시점)

현상 유지 하에서 가능한 경미한 개선:
- 전문가 TTL 24h → 12h 단축 (auth.js:35 상수 변경)
- 검증 폴링 15분 → 10분 단축 (useExpertMode.js 상수 변경)
- CSP strict-dynamic 강화 (XSS 1차 방어)
