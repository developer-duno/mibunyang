# docs/decisions/ — 아키텍처 결정 기록 (ADR)

> 프로젝트의 중요한 기술적·정책적 결정을 기록한다. BACKLOG/SESSION_LOG 의 메모를 ADR 로 승격해 미래의 자신·다른 사람이 같은 고민을 반복하지 않게 한다.

## 색인

| 파일 | 결정 | 세션 | 상태 |
|---|---|---|---|
| [avg_price-policy.md](avg_price-policy.md) | `regions.avg_price` 100% NULL 컬럼 옵션 1-A 보류 채택 | 316 / 334 | ✅ 확정 |

## ADR 박힘 패턴

신규 ADR 박힘 시 다음 절차:

1. `docs/decisions/<topic>-policy.md` 파일 신규 (kebab-case)
2. 본문 = `# 제목` + `## 결정` + `## 근거` + `## 옵션 비교` + `## 재오픈 트리거` + `## 답습 자산`
3. 본 README 색인 표에 1줄 추가
4. BACKLOG.md 의 해당 메모 → ADR 파일 링크로 정정

## 신규 트리거

- 같은 결정 자리 답습 2회+ 박힘 시
- 옵션 비교 2개+ 박힘 시
- cross-repo 영향 자리 박힘 시
- 외부 의존성 (사용자/팀/회사) 박힘 시
