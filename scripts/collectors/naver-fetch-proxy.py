#!/usr/bin/env python3
"""
네이버 부동산 API 프록시 — curl_cffi Chrome TLS 핑거프린트 사용

모드 1 (단일 요청): python3 naver-fetch-proxy.py <url> [--auth] [--complex-id=123]
모드 2 (배치):      python3 naver-fetch-proxy.py --batch < requests.jsonl > responses.jsonl

배치 모드 — stdin에서 JSONL 읽기:
  {"url": "...", "auth": true, "complex_id": "123"}
  stdout으로 JSONL 응답:
  {"ok": true, "data": {...}}
  {"ok": false, "error": "..."}
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

session = cffi_requests.Session(impersonate="chrome")

_jwt_token = None
_jwt_time = 0
JWT_LIFETIME = 2800


def log(msg):
    print(f"[proxy] {msg}", file=sys.stderr)


def ensure_jwt(complex_id=None):
    global _jwt_token, _jwt_time
    now = time.time()
    if _jwt_token and (now - _jwt_time) < JWT_LIFETIME:
        return _jwt_token

    target = complex_id or "217"
    url = f"{NAVER_BASE}/complexes/{target}"
    log(f"JWT 획득 중... ({target})")
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
    log(f"JWT 획득 완료 ({_jwt_token[:20]}...)")
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
            if r.status_code in (401, 403):
                global _jwt_token
                _jwt_token = None
                if need_auth:
                    token = ensure_jwt(complex_id)
                    headers["Authorization"] = f"Bearer {token}"
                time.sleep(2)
                continue
            if r.status_code == 429:
                wait = 3 * (attempt + 1)
                log(f"429 Rate Limit — {wait}s 대기")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 2:
                raise
            wait = 2 * (attempt + 1)
            log(f"재시도 {attempt+1}/3: {e} — {wait}s 대기")
            time.sleep(wait)

    raise RuntimeError("Max retries exceeded")


def run_single(url, need_auth, complex_id):
    data = fetch(url, need_auth=need_auth, complex_id=complex_id)
    json.dump(data, sys.stdout, ensure_ascii=False)


def run_batch():
    """stdin에서 JSONL 읽어서 각 요청 처리, stdout으로 JSONL 응답"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            url = req["url"]
            need_auth = req.get("auth", False)
            complex_id = req.get("complex_id")
            
            data = fetch(url, need_auth=need_auth, complex_id=complex_id)
            result = {"ok": True, "data": data}
        except Exception as e:
            log(f"요청 실패: {e}")
            result = {"ok": False, "error": str(e)}
        
        print(json.dumps(result, ensure_ascii=False), flush=True)
        time.sleep(1)  # rate limit


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", help="Full URL to fetch")
    parser.add_argument("--auth", action="store_true")
    parser.add_argument("--complex-id", default=None)
    parser.add_argument("--batch", action="store_true", help="Batch mode: read JSONL from stdin")
    args = parser.parse_args()

    if args.batch:
        run_batch()
    elif args.url:
        try:
            run_single(args.url, args.auth, args.complex_id)
        except Exception as e:
            log(f"ERROR: {e}")
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
