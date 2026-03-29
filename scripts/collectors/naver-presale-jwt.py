#!/usr/bin/env python3
"""
네이버 부동산 JWT 추출 헬퍼 — new.land.naver.com
curl_cffi Chrome TLS fingerprint로 JWT 토큰 획득 후 stdout 출력.

2026-03 현재 pre.land POST API는 JWT 불필요하지만,
향후 인증 필요 시 fallback으로 사용.

naver-presale.mjs의 ensureJwt()에서 child_process로 호출됨.
stdout: JWT 토큰 문자열만 (로그는 stderr)
exit code: 0=성공, 1=실패

사용법:
  python3 scripts/collectors/naver-presale-jwt.py
"""
import sys, re, time

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    print("curl_cffi 미설치 — pip install curl_cffi", file=sys.stderr)
    sys.exit(1)

# new.land.naver.com에서 JWT 추출 (naver-collect.py ejwt() 패턴)
NV_BASE = "https://new.land.naver.com"
SEED_COMPLEX = "217"
JWT_PATTERNS = [
    re.compile(r'"token":"(eyJ[A-Za-z0-9._-]+)"'),
    re.compile(r'token\s*[:=]\s*["\']?(eyJ[A-Za-z0-9._-]+)["\']?'),
    re.compile(r'"accessToken"\s*:\s*"(eyJ[A-Za-z0-9._-]+)"'),
]
MAX_RETRIES = 3
RETRY_DELAYS = [2, 5, 10]


def log(msg):
    print(f"[presale-jwt] {msg}", file=sys.stderr)


def extract_jwt():
    """new.land.naver.com에서 JWT 토큰 추출."""
    ss = cffi_requests.Session(impersonate="chrome")

    for attempt in range(MAX_RETRIES):
        try:
            url = f"{NV_BASE}/complexes/{SEED_COMPLEX}"
            r = ss.get(url, headers={"Accept": "text/html"}, timeout=30)
            if r.status_code in (403, 429):
                delay = RETRY_DELAYS[attempt] if attempt < len(RETRY_DELAYS) else 10
                log(f"HTTP {r.status_code} — {delay}초 후 재시도 ({attempt + 1}/{MAX_RETRIES})")
                time.sleep(delay)
                continue
            r.raise_for_status()

            for pat in JWT_PATTERNS:
                m = pat.search(r.text)
                if m:
                    token = m.group(1)
                    log(f"JWT 획득 ({token[:20]}...)")
                    return token

            log(f"JWT 패턴 미매칭 (HTML 길이={len(r.text)})")
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAYS[attempt])
                continue
            return None

        except Exception as e:
            log(f"요청 실패: {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAYS[attempt])
                continue
            return None

    return None


if __name__ == "__main__":
    token = extract_jwt()
    if token:
        print(token, end="")  # stdout: 토큰만 (개행 없음)
        sys.exit(0)
    else:
        log("JWT 추출 최종 실패")
        sys.exit(1)
