#!/usr/bin/env python3
"""
네이버 부동산 API를 통한 총세대수 보정 + 분양권 동/호수 수집
- units <= 1인 아파트의 totalHouseholdCount 보정
- 아파트분양권(ABYG) / 분양예약(PRE) 매물 정보 수집
- 분양권 매물의 동/호수 정보 추출

실행: python scripts/naver-units.py
출력: public/data/naver-units.json
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from difflib import SequenceMatcher

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    print("curl_cffi 미설치 — pip install curl_cffi")
    sys.exit(1)

# ── 설정 ──
NAVER_LAND_BASE = "https://new.land.naver.com"
NAVER_SEARCH_API = f"{NAVER_LAND_BASE}/api/search"
NAVER_COMPLEX_API = f"{NAVER_LAND_BASE}/api/complexes"
NAVER_ARTICLES_API = f"{NAVER_LAND_BASE}/api/articles/complex"

JWT_TOKEN_PATTERN = r'"token":"(eyJ[A-Za-z0-9._-]+)"'
MIN_REQUEST_INTERVAL = 1.5  # 초
MAX_RETRIES = 3
RETRY_DELAYS = [3, 5, 10]

# 분양권 관련 매물 타입
PRESALE_TYPES = {"ABYG", "PRE"}  # ABYG: 아파트분양권, PRE: 분양예약

# 경로
ROOT = Path(__file__).resolve().parent.parent
APARTMENTS_PATH = ROOT / "public" / "data" / "apartments.json"
OUTPUT_PATH = ROOT / "public" / "data" / "naver-units.json"

# ── 세션 관리 ──
session = cffi_requests.Session(impersonate="chrome")
_jwt_token = None
_jwt_token_time = 0
_last_request_time = 0


def log(msg):
    print(f"[naver-units] {msg}")


def rate_limit():
    """요청 간 최소 간격 보장"""
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < MIN_REQUEST_INTERVAL:
        time.sleep(MIN_REQUEST_INTERVAL - elapsed)
    _last_request_time = time.time()


def ensure_jwt(complex_id="100"):
    """JWT 토큰 추출 (네이버 부동산 페이지에서, 최대 3회 재시도)"""
    global _jwt_token, _jwt_token_time
    if _jwt_token and (time.time() - _jwt_token_time) < 2400:  # 40분
        return _jwt_token
    fallback_ids = [complex_id, "217", "1"]
    for attempt, cid in enumerate(fallback_ids):
        rate_limit()
        try:
            r = session.get(f"{NAVER_LAND_BASE}/complexes/{cid}", timeout=60)
            match = re.search(JWT_TOKEN_PATTERN, r.text)
            if match:
                _jwt_token = match.group(1)
                _jwt_token_time = time.time()
                log("JWT 토큰 갱신 완료")
                return _jwt_token
            log(f"JWT 토큰 패턴 미매칭 (complex={cid}, status={r.status_code})")
        except Exception as e:
            log(f"JWT 토큰 추출 실패 (시도 {attempt+1}/3): {e}")
        if attempt < len(fallback_ids) - 1:
            delay = RETRY_DELAYS[attempt] if attempt < len(RETRY_DELAYS) else 10
            log(f"  {delay}초 후 재시도...")
            time.sleep(delay)
    return None


def api_get(url, params=None, need_auth=True, referer_path=None):
    """네이버 API GET 요청 (재시도 + 토큰 갱신)"""
    for attempt in range(MAX_RETRIES):
        rate_limit()
        headers = {}
        if need_auth:
            token = ensure_jwt()
            if token:
                headers["Authorization"] = f"Bearer {token}"
            if referer_path:
                headers["Referer"] = f"{NAVER_LAND_BASE}{referer_path}"
        try:
            r = session.get(url, params=params, headers=headers)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (401, 403):
                log(f"  인증 만료 (HTTP {r.status_code}), 토큰 갱신 중...")
                global _jwt_token
                _jwt_token = None
                continue
            if r.status_code == 429:
                delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                log(f"  Rate limit, {delay}초 대기...")
                time.sleep(delay)
                continue
            log(f"  HTTP {r.status_code}: {url}")
        except Exception as e:
            log(f"  요청 실패 (시도 {attempt + 1}): {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)])
    return None


def similarity(a, b):
    """두 문자열의 유사도 (0~1)"""
    a = re.sub(r'\s+', '', a)
    b = re.sub(r'\s+', '', b)
    return SequenceMatcher(None, a, b).ratio()


def search_complex(name, region=None):
    """아파트 이름으로 네이버 단지 검색"""
    # 검색어 정제: "OO아파트" → 그대로, 괄호 제거
    keyword = re.sub(r'\([^)]*\)', '', name).strip()
    data = api_get(NAVER_SEARCH_API, params={"keyword": keyword}, need_auth=False)
    if not data or "complexes" not in data:
        return None

    complexes = data.get("complexes", [])
    if not complexes:
        return None

    # 이름 + 지역 유사도로 최적 매칭
    best = None
    best_score = 0
    for c in complexes:
        cname = c.get("complexName", "")
        score = similarity(keyword, cname)
        # 지역 보너스
        if region:
            addr = c.get("address", "") + c.get("roadAddress", "")
            if region in addr:
                score += 0.2
        if score > best_score:
            best_score = score
            best = c

    if best and best_score >= 0.4:
        return {
            "complexNo": best.get("complexNo"),
            "complexName": best.get("complexName"),
            "score": round(best_score, 2)
        }
    return None


def get_complex_detail(complex_no):
    """단지 상세 정보 (totalHouseholdCount 등)"""
    url = f"{NAVER_COMPLEX_API}/{complex_no}"
    return api_get(url, referer_path=f"/complexes/{complex_no}")


def get_presale_articles(complex_no):
    """분양권 매물 조회 (ABYG: 아파트분양권, PRE: 분양예약)"""
    articles = []
    for rtype in ["ABYG", "PRE"]:
        url = f"{NAVER_ARTICLES_API}/{complex_no}"
        params = {
            "realEstateType": rtype,
            "tradeType": "",
            "tag": "",
            "rentPriceMin": 0,
            "rentPriceMax": 900000000,
            "priceMin": 0,
            "priceMax": 900000000,
            "areaMin": 0,
            "areaMax": 900000000,
            "page": 1,
            "complexNo": complex_no,
        }
        data = api_get(url, params=params, referer_path=f"/complexes/{complex_no}")
        if not data:
            continue
        article_list = data.get("articleList", [])
        for a in article_list:
            articles.append({
                "type": rtype,
                "typeName": "아파트분양권" if rtype == "ABYG" else "분양예약",
                "building": a.get("buildingName", ""),   # 동
                "floor": a.get("floorInfo", ""),          # 층
                "area": a.get("area2") or a.get("area1"),  # 전용면적
                "price": a.get("dealOrWarrantPrc", ""),   # 가격
                "direction": a.get("direction", ""),
                "articleNo": a.get("articleNo"),
                "confirmDate": a.get("articleConfirmYmd", ""),
            })
    return articles


def load_apartments():
    """apartments.json에서 units <= 1인 아파트 로드"""
    if not APARTMENTS_PATH.exists():
        log(f"apartments.json 미존재: {APARTMENTS_PATH}")
        return []
    try:
        with open(APARTMENTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        apts = data if isinstance(data, list) else data.get("data", [])
        # units <= 1이거나 units가 null인 아파트만 필터
        targets = [a for a in apts if (a.get("units") or 0) <= 1]
        log(f"총 {len(apts)}건 중 보정 대상: {len(targets)}건 (units <= 1)")
        return targets
    except Exception as e:
        log(f"apartments.json 파싱 실패: {e}")
        return []


def load_existing():
    """기존 naver-units.json 로드 (증분 업데이트)"""
    if not OUTPUT_PATH.exists():
        return {"fetchedAt": None, "corrections": {}, "presaleArticles": {}}
    try:
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"fetchedAt": None, "corrections": {}, "presaleArticles": {}}


def main():
    log("네이버 부동산 세대수 보정 시작")
    targets = load_apartments()
    if not targets:
        log("보정 대상 없음, 종료")
        return

    existing = load_existing()
    corrections = existing.get("corrections", {})
    presale_articles = existing.get("presaleArticles", {})

    # JWT 토큰 사전 확보
    token = ensure_jwt()
    if not token:
        log("JWT 토큰 확보 실패, 종료")
        return

    success = 0
    fail = 0
    presale_found = 0

    for i, apt in enumerate(targets):
        apt_id = apt.get("id", "")
        name = apt.get("name", "")
        region = apt.get("region", "")
        log(f"[{i + 1}/{len(targets)}] {name} ({region})")

        # 이미 보정된 건 스킵 (강제 갱신하려면 기존 JSON 삭제)
        if apt_id in corrections and corrections[apt_id].get("units", 0) > 1:
            log(f"  → 이미 보정됨 (units={corrections[apt_id]['units']}), 스킵")
            success += 1
            continue

        # 1. 네이버 검색
        result = search_complex(name, region)
        if not result:
            log(f"  → 검색 결과 없음")
            fail += 1
            continue

        complex_no = result["complexNo"]
        log(f"  → 매칭: {result['complexName']} (complexNo={complex_no}, 유사도={result['score']})")

        # 2. 단지 상세 → totalHouseholdCount
        detail = get_complex_detail(complex_no)
        if detail:
            total = detail.get("totalHouseholdCount")
            if total and total > 1:
                corrections[apt_id] = {
                    "units": total,
                    "source": "naver",
                    "complexNo": complex_no,
                    "complexName": result["complexName"],
                    "matchScore": result["score"],
                }
                log(f"  → 총세대수: {total}")
                success += 1
            else:
                log(f"  → totalHouseholdCount 없음 또는 1 이하")
                fail += 1
        else:
            log(f"  → 단지 상세 조회 실패")
            fail += 1

        # 3. 분양권 매물 조회 (ABYG/PRE)
        articles = get_presale_articles(complex_no)
        if articles:
            presale_articles[apt_id] = {
                "complexNo": complex_no,
                "complexName": result["complexName"],
                "articles": articles,
                "fetchedAt": datetime.now(timezone(timedelta(hours=9))).isoformat(),
            }
            abyg_count = sum(1 for a in articles if a["type"] == "ABYG")
            pre_count = sum(1 for a in articles if a["type"] == "PRE")
            buildings = sorted(set(
                a["building"] for a in articles if a["building"]
            ))
            log(f"  → 분양권 매물: 아파트분양권 {abyg_count}건, 분양예약 {pre_count}건")
            if buildings:
                log(f"     동: {', '.join(buildings)}")
            presale_found += 1

    # 결과 저장
    kst = timezone(timedelta(hours=9))
    output = {
        "fetchedAt": datetime.now(kst).isoformat(),
        "corrections": corrections,
        "presaleArticles": presale_articles,
        "stats": {
            "totalTargets": len(targets),
            "corrected": success,
            "failed": fail,
            "presaleFound": presale_found,
        }
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    log(f"완료: 보정 {success}건, 실패 {fail}건, 분양권 {presale_found}건")
    log(f"저장: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
