# 네이버 아파트 주변동향 크롤러

미분양 아파트 주변의 네이버 부동산 데이터를 수집합니다.

## 구조

```
naver-apt/
├── src/
│   ├── naver-api.mjs    # 네이버 부동산 API 클라이언트
│   └── crawl.mjs        # 메인 크롤러
├── output/
│   └── nearby-trends.json  # 수집 결과 (자동 생성)
├── package.json
└── README.md
```

## 사용법

```bash
cd naver-apt

# 전체 수집
node src/crawl.mjs

# 테스트 (수집 없이 대상만 출력)
node src/crawl.mjs --dry-run

# 처음 5개 단지만
node src/crawl.mjs --limit=5

# 특정 지역만
node src/crawl.mjs --region=경기
```

## 데이터 흐름

```
[미분양] apartments.json → 단지 목록 + 좌표
                              ↓
[크롤러] 네이버 검색 → 반경 3km 주변 단지 찾기
                              ↓
         단지 상세 + 매물(매매/전세/월세) + 시세 이력 수집
                              ↓
         output/nearby-trends.json 저장
                              ↓
[미분양] collect-data.mjs에서 병합 → apartments.json 주변동향 필드 업데이트
```

## 출력 형식

```json
{
  "version": "1.0",
  "generatedAt": "2026-03-09T...",
  "totalApartments": 100,
  "trends": {
    "ah-2026930006": {
      "aptId": "ah-2026930006",
      "aptName": "의왕 더샵캐슬",
      "nearbyCount": 15,
      "complexes": [...],
      "articles": { "sell": [...], "jeonse": [...], "wolse": [...] },
      "priceStats": {
        "nearbyMedian": 113000,
        "jeonseRate": 59,
        "priceByArea": [...],
        "rentByArea": [...],
        "jeonseByArea": [...],
        "priceByFloor": [...]
      }
    }
  }
}
```

## 주의사항

- 네이버 요청 간 최소 1초 간격 유지 (rate limiting)
- JWT 토큰 50분마다 자동 갱신
- 10건 처리마다 중간 저장 (중단 후 이어받기 가능)
- 24시간 이내 수집된 단지는 자동 스킵
