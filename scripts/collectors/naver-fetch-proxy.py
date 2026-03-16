#!/usr/bin/env python3
"""
네이버 부동산 API 프록시 — curl_cffi Chrome TLS 핑거프린트 사용

Node.js에서 subprocess로 호출:
  python3 naver-fetch-proxy.py <url> [--auth] [--complex-id=123]

stdout으로 JSON 응답 출력. 에러 시 exit(1) + stderr.
"""
import sys
import json
import re
import time

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    print("curl_cffi not installed. Run: pip install curl_cffi", file=sys.stderr)
    sys.exit(1)

NAVER_BASE = "https://new.land.naver.com"
JWT_PATTERN = r'"token":"(eyJ[A-Za-z0-9._-]+)"'
ALT_PATTERNS = [
    r'token\s*[:=]\s*["\x27](eyJ[A-Za-z0-9._-]+)["\x27]',
    r'"accessToken"\s*:\s*"(eyJ[A-Za-z0-9._-]+)"',
    r'Bearer\s+(eyJ[A-Za-z0-9._-]+)',
]

# 세션 — Chrome TLS 핑거프린트
session = cffi_requests.Session(impersonate="chrome")

_jwt_token = None
_jwt_time = 0
JWT_LIFETIME = 2800  # seconds (안전 마진)


def ensure_jwt(complex_id=None):
    global _jwt_token, _jwt_time
    now = time.time()
    if _jwt_token and (now - _jwt_time) < JWT_LIFETIME:
        return _jwt_token

    target = complex_id or "217"
    url = f"{NAVER_BASE}/complexes/{target}"
    r = session.get(url, headers={"Accept": "text/html"}, timeout=30)
    r.raise_for_status()

    m = re.search(JWT_PATTERN, r.text)
    if not m:
        for pat in ALT_PATTERNS:
            m = re.search(pat, r.text)
            if m:
                break
    if not m:
        raise RuntimeError("JWT token not found in HTML")

    _jwt_token = m.group(1)
    _jwt_time = now
    return _jwt_token


def fetch(url, need_auth=False, complex_id=None):
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    }
    if need_auth:
        token = ensure_jwt(complex_id)
        headers["Authorization"] = f"Bearer {token}"
        if complex_id:
            headers["Referer"] = f"{NAVER_BASE}/complexes/{complex_id}"

    for attempt in range(3):
        try:
            r = session.get(url, headers=headers, timeout=30)
            if r.status_code == 401 or r.status_code == 403:
                global _jwt_token
                _jwt_token = None
                if need_auth:
                    token = ensure_jwt(complex_id)
                    headers["Authorization"] = f"Bearer {token}"
                time.sleep(2)
                continue
            if r.status_code == 429:
                time.sleep(3 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))

    raise RuntimeError("Max retries exceeded")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="Full URL to fetch")
    parser.add_argument("--auth", action="store_true", help="Include JWT auth")
    parser.add_argument("--complex-id", default=None, help="Complex ID for Referer")
    args = parser.parse_args()

    try:
        data = fetch(args.url, need_auth=args.auth, complex_id=args.complex_id)
        json.dump(data, sys.stdout, ensure_ascii=False)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
