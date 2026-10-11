## 세션566 이관 (2026-09-23) — BACKLOG 완료 색인

> BACKLOG.md `## ✅ 완료된 일 (색인)` 절의 오래된 완료 항목 1건 + 전부 무효화된 "네이버 지도" 절(세션 449 카카오 단일화로 후속 전부 무효)을 그대로 옮김. 손실 0 — 이동 전후 `grep -c "^- ✅"` 합계·바이트 대조 완료.

- ✅ 청약홈 매칭 회수 검증 (P2) — 세션 465 라이브 실증 종결 (2026-07-03). `collector_runs` id=236 `applyhome-detail` 6/13 cron(`30 2 13 * *`) 자연 발화 success **ok=934 fail=0**(예측 ~916 + 이후 신규 공고 자연 증가) + `presale_schedule_official` 라이브 = **984 rows / 859 distinct 단지**(예측 916/810 초과 달성). 세션 360 처방(후보 쿼리 presale_stage 제약 제거 = 전체 apartments 확대) 2.4배 회복(393→934) 실증 확정. 상세 = BACKLOG_ARCHIVE "🟡 곧 — 완료".

## ✅ 네이버 지도 — 세션 449에 전면 제거 (카카오 단일화)

> **세션 449**: 네이버 지도(NaverMapView·naverMapHelpers·MarkerClustering.js·provider 토글)를 전면 제거하고 카카오 단일화. 근거 = 네이버 v3 POI API 부재로 구조적 열위 + 두 SDK·줌 좌표계 반대로 버그 표면 2배(세션 448 production 크래시) > 입증된 가치(사용률 미계측). 아래 후속 후보들은 전부 무효(네이버 자체가 사라짐). `VITE_NAVER_MAP_CLIENT_ID`(vite-env·CSP) 제거 완료. 👤 잔여 = `.env.example`·Vercel 대시보드 환경변수 수동 정리(있으면, 남겨도 무해).

- ~~Vercel Preview 환경변수 `VITE_NAVER_MAP_CLIENT_ID`~~ · ~~색칠·인프라 오버레이 네이버화~~ — 세션 449 네이버 제거로 둘 다 무효.

---

