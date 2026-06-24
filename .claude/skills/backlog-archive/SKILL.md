---
name: backlog-archive
description: BACKLOG.md 가 비대해지면 완료 색인(✅)을 BACKLOG_ARCHIVE 로 옮겨 "할 일"만 남긴다. grep 비용·컨텍스트 부채를 줄인다. Claude 가 스스로 판단해 발동 — BACKLOG 가 100KB+ 또는 완료 색인이 수십 줄 누적됐을 때, "BACKLOG 정리", "백로그 비대" 표현 시. 사용 안 함 = 활성 작업 항목 편집.
when_to_use: |
  Claude 가 자동 판단해 발동:
  - BACKLOG.md 가 비대(100KB+ 또는 완료 색인 과다 누적)
  - "BACKLOG 정리", "백로그 아카이브", "완료 색인 분할" 표현
  - 감사·부팅 점검에서 컨텍스트 부채로 지적됨
  사용 안 함:
  - 활성(미완료) 항목 편집 / 단일 항목 추가
allowed-tools: Read, Edit, Bash
---

`.claude/BACKLOG.md` 는 **"할 일"만** 유지하는 게 원칙(파일 상단 운영 규칙). 완료(✅) 색인이 누적되면 grep 노이즈·컨텍스트 부채가 된다. 오래된 완료 색인을 `BACKLOG_ARCHIVE.md`(또는 분기별 ARCHIVE)로 옮긴다.

## 절차

### 1. 현황 측정
```bash
wc -c .claude/BACKLOG.md .claude/BACKLOG_ARCHIVE.md
grep -c "^- ✅" .claude/BACKLOG.md     # 완료 색인 줄 수
grep -n "## ✅ 완료" .claude/BACKLOG.md # 완료 섹션 위치
```

### 2. 이동 기준 결정
- **활성(🔴/🟡/🟢 미완료) 항목은 절대 이동 금지** — "할 일"이라 BACKLOG 에 남음.
- 완료(✅) 색인 중 **오래된 것**(예: 특정 세션 번호 이전)을 이동. 최근 ~20개 완료는 "중복 플랜 방지 grep" 용도라 BACKLOG 에 남기는 게 유용 — 너무 공격적으로 비우지 말 것.
- 분기/연도별 ARCHIVE 분할 가능(BACKLOG_ARCHIVE_2026Q2.md 등). 기존 BACKLOG_ARCHIVE.md 패턴 답습.

### 3. 이동 실행 (손실 0)
- 옮길 완료 색인을 ARCHIVE 파일 끝에 append(Edit) → BACKLOG 에서 제거(Edit).
- **반드시 1줄도 손실 없이** — 이동 전후 `grep -c "^- ✅"` 합계 보존 확인.
- BACKLOG 상단 "완료 항목은 ARCHIVE 로 이동" 안내 + ARCHIVE 링크 유지.

### 4. 검증
```bash
# 이동 전 BACKLOG ✅ N개 + ARCHIVE M개 = 이동 후 BACKLOG (N-k)개 + ARCHIVE (M+k)개
grep -c "^- ✅" .claude/BACKLOG.md .claude/BACKLOG_ARCHIVE*.md
wc -c .claude/BACKLOG.md   # 줄어들었는지
```

## 안티 패턴

- ❌ 활성(미완료) 항목 이동 — "할 일"을 숨김.
- ❌ 최근 완료 전부 비우기 — 중복 플랜 방지 grep 용도 상실. 오래된 것만.
- ❌ 이동 중 줄 손실 — 이동 전후 ✅ 카운트 합계 보존 검증 필수.

> 답습: 세션 439 감사 — BACKLOG 120KB 컨텍스트 부채 지적. 기존 BACKLOG_ARCHIVE.md(39KB) 패턴 답습.
