// @ts-check
/**
 * _shared.mjs 테스트 — 순수 유틸 함수 검증 (모킹 불필요)
 */
import { describe, it, expect, vi } from "vitest";
import {
  resolveBuilder, stringSimilarity, today, sleep,
  REGION_MAP, VALID_REGIONS, createReporter, recordCollectorRun, recordApiQuota,
  REGION_LAWD_PREFIX, GU_LAWD_MAP, getLawdCd, normalizeGu, guParentCity,
  setupGracefulShutdown, clampUnsoldRate, budgetExceeded, fetchWithRetry,
  BUILDER_ALIASES, BUILDER_CANONICALS,
} from "./_shared.mjs";
import {
  resolveBuilder as brandsResolveBuilder,
  BUILDER_ALIASES as BRANDS_BUILDER_ALIASES,
  BRAND_TIER,
} from "@/constants/brands";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * 별칭표 정본을 **직접 읽는다**. 소스 정규식으로 세면 표가 늘거나 줄 때 가드가 조용히 뒤처진다
 * (세션491: 정규식 가드가 선언부·주석에 걸려 통째로 무효였던 선례).
 * `_shared.mjs` 와 같은 fs 방식 — import 속성 문제를 피한다.
 * @type {Array<{ region: string, canonical: string, parentCity: string, forms: string[] }>}
 */
const GU_ALIAS_ENTRIES = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/data/sigungu-aliases.json"),
    "utf8",
  ),
).entries;

/**
 * 엔트리에서 구명만 뽑는다. **정식 2단 form 에서만** 뽑아야 한다 —
 * bare·압축형까지 긁으면 "고양고양덕양구" 같은 겹말이 나온다(세션522 생성기 실사고).
 * @param {{ parentCity: string, forms: string[] }} e
 * @returns {string[]}
 */
function guNamesOf(e) {
  return e.forms.filter((f) => f.startsWith(e.parentCity + " ")).map((f) => f.slice(e.parentCity.length + 1));
}

describe("resolveBuilder", () => {
  // 정방향: 원본 이름이 별칭 테이블에 없으면 원본 반환
  it("GS건설은 그대로 반환한다", () => {
    expect(resolveBuilder("GS건설")).toBe("GS건설");
  });

  // 별칭 해소
  it("지에스건설 → GS건설 별칭 해소", () => {
    expect(resolveBuilder("지에스건설")).toBe("GS건설");
  });

  it("(주)현대건설 → 현대건설 별칭 해소", () => {
    expect(resolveBuilder("(주)현대건설")).toBe("현대건설");
  });

  // 알 수 없는 건설사
  it("알 수 없는 건설사는 원본(trim) 반환", () => {
    expect(resolveBuilder("무명건설")).toBe("무명건설");
  });

  // null/undefined
  it("null 입력 시 '기타' 반환", () => {
    expect(resolveBuilder(null)).toBe("기타");
  });

  it("빈 문자열 시 '기타' 반환", () => {
    expect(resolveBuilder("")).toBe("기타");
  });
});

describe("stringSimilarity", () => {
  // 동일 문자열
  it("동일 문자열은 1.0을 반환한다", () => {
    expect(stringSimilarity("힐스테이트", "힐스테이트")).toBe(1);
  });

  // 완전 다른 문자열
  it("완전 다른 문자열은 0에 가까운 값을 반환한다", () => {
    expect(stringSimilarity("가나다", "ABCDE")).toBe(0);
  });

  // 부분 유사
  it("부분 유사 문자열은 0~1 사이값을 반환한다", () => {
    const sim = stringSimilarity("힐스테이트화성", "힐스테이트수원");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  // 빈 문자열
  it("빈 문자열은 0을 반환한다", () => {
    expect(stringSimilarity("", "테스트")).toBe(0);
  });

  // null 처리
  it("null 입력은 0을 반환한다", () => {
    expect(stringSimilarity(null, "테스트")).toBe(0);
  });
});

describe("today (KST 고정)", () => {
  it("YYYY-MM-DD 형식을 반환한다", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 환경 무관 증명 — UTC 자정 직전(=KST 익일)에 today() 가 KST 날짜를 줘야 한다.
  // GitHub Actions(UTC 러너)에서 KST 05:30~08:00 발화 시 recorded_at 하루 밀림 차단의 핵심 보증.
  it("UTC 23:30 (= KST 익일 08:30) 에 KST 날짜를 반환한다", () => {
    vi.useFakeTimers();
    try {
      // 2026-06-15T23:30:00Z = KST 2026-06-16 08:30 → today() 는 06-16 이어야 함
      vi.setSystemTime(new Date("2026-06-15T23:30:00Z"));
      expect(today()).toBe("2026-06-16");
    } finally {
      vi.useRealTimers();
    }
  });

  it("UTC 14:59 (= KST 동일일 23:59) 에 KST 날짜를 반환한다", () => {
    vi.useFakeTimers();
    try {
      // 2026-06-16T14:59:00Z = KST 2026-06-16 23:59 → today() 는 06-16 (UTC toISOString 도 06-16, 경계 안)
      vi.setSystemTime(new Date("2026-06-16T14:59:00Z"));
      expect(today()).toBe("2026-06-16");
    } finally {
      vi.useRealTimers();
    }
  });

  it("UTC 15:00 (= KST 익일 00:00) 에 KST 익일 날짜를 반환한다 (UTC 와 갈리는 경계)", () => {
    vi.useFakeTimers();
    try {
      // 2026-06-16T15:00:00Z = UTC 06-16 BUT KST 2026-06-17 00:00 → today() 는 06-17 (UTC toISOString 이면 06-16 = 옛 버그)
      vi.setSystemTime(new Date("2026-06-16T15:00:00Z"));
      expect(today()).toBe("2026-06-17");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("clampUnsoldRate (세션 445 — 100% 초과 무력화)", () => {
  it("100% 초과는 null (폭발값 무력화)", () => {
    expect(clampUnsoldRate(229.4)).toBe(null);
    expect(clampUnsoldRate(2900)).toBe(null);
    expect(clampUnsoldRate(100.1)).toBe(null);
  });

  it("100 이하(100 포함)는 그대로", () => {
    expect(clampUnsoldRate(100)).toBe(100);
    expect(clampUnsoldRate(7.2)).toBe(7.2);
    expect(clampUnsoldRate(0)).toBe(0);
  });

  it("null/undefined 입력은 null 출력", () => {
    expect(clampUnsoldRate(null)).toBe(null);
    expect(clampUnsoldRate(undefined)).toBe(null);
  });
});

describe("REGION_MAP / VALID_REGIONS", () => {
  it("VALID_REGIONS는 17개 시도를 포함한다", () => {
    expect(VALID_REGIONS).toHaveLength(17);
  });

  it("REGION_MAP에 주요 시도가 매핑되어 있다", () => {
    expect(REGION_MAP["서울특별시"]).toBe("서울");
    expect(REGION_MAP["경기도"]).toBe("경기");
    expect(REGION_MAP["제주특별자치도"]).toBe("제주");
  });
});

describe("REGION_LAWD_PREFIX / GU_LAWD_MAP", () => {
  it("REGION_LAWD_PREFIX는 17개 시도 매핑", () => {
    expect(Object.keys(REGION_LAWD_PREFIX)).toHaveLength(17);
    expect(REGION_LAWD_PREFIX["서울"]).toBe("11");
    expect(REGION_LAWD_PREFIX["제주"]).toBe("50");
  });

  it("GU_LAWD_MAP은 17개 region 중첩 구조", () => {
    expect(Object.keys(GU_LAWD_MAP)).toHaveLength(17);
    expect(GU_LAWD_MAP["서울"]["강남구"]).toBe("11680");
    expect(GU_LAWD_MAP["부산"]["중구"]).toBe("26110");
    expect(GU_LAWD_MAP["경남"]["거제시"]).toBe("48310");
    expect(GU_LAWD_MAP["제주"]["제주시"]).toBe("50110");
    // 강원특별자치도·전북특별자치도 출범 이후 51xxx/52xxx 개편 코드
    expect(GU_LAWD_MAP["강원"]["춘천시"]).toBe("51110");
    expect(GU_LAWD_MAP["전북"]["전주시 완산구"]).toBe("52111");
    expect(GU_LAWD_MAP["전북"]["전주시 덕진구"]).toBe("52113");
  });

  it("GU_LAWD_MAP 각 코드는 5자리 문자열", () => {
    for (const guMap of Object.values(GU_LAWD_MAP)) {
      for (const code of Object.values(guMap)) {
        expect(code).toMatch(/^\d{5}$/);
      }
    }
  });
});

describe("getLawdCd", () => {
  // 동명이구 해소 — region별 정확한 코드 반환
  it("서울 중구 → 11140", () => {
    expect(getLawdCd("서울", "중구")).toBe("11140");
  });
  it("부산 중구 → 26110", () => {
    expect(getLawdCd("부산", "중구")).toBe("26110");
  });
  it("울산 중구 → 31110", () => {
    expect(getLawdCd("울산", "중구")).toBe("31110");
  });

  // 고유 키 직접 매칭
  it("서울 강남구 → 11680", () => {
    expect(getLawdCd("서울", "강남구")).toBe("11680");
  });
  it("경기 화성시 → 41591", () => {
    expect(getLawdCd("경기", "화성시")).toBe("41591");
  });

  // shortGu 접두사 매칭 (최소 2자)
  it("경기 수원 → 41110 (접미사 제거 후 접두사 매칭)", () => {
    expect(getLawdCd("경기", "수원")).toBe("41110");
  });

  // null/undefined 가드
  it("gu가 null이면 prefix 폴백", () => {
    expect(getLawdCd("서울", null)).toBe("11000");
  });
  it("미등록 region → null", () => {
    expect(getLawdCd("미래도", "미래구")).toBeNull();
  });

  it("강원 춘천시 → 51110 (강원특별자치도)", () => {
    expect(getLawdCd("강원", "춘천시")).toBe("51110");
  });
  it("전북 전주시 덕진구 → 52113 (전북특별자치도)", () => {
    expect(getLawdCd("전북", "전주시 덕진구")).toBe("52113");
  });
  it("전북 전주시 완산구 → 52111", () => {
    expect(getLawdCd("전북", "전주시 완산구")).toBe("52111");
  });
  it("경남 거제시 → 48310", () => {
    expect(getLawdCd("경남", "거제시")).toBe("48310");
  });
  it("제주 서귀포시 → 50130", () => {
    expect(getLawdCd("제주", "서귀포시")).toBe("50130");
  });
  it("세종 null gu → 36110 (특별자치시)", () => {
    expect(getLawdCd("세종", null)).toBe("36110");
  });
  it("세종 임의 gu → 36110 (region 단일)", () => {
    expect(getLawdCd("세종", "행정중심복합도시")).toBe("36110");
  });
  // 통합시 복합 gu (정식)
  it("충북 청주시 흥덕구 → 43113", () => {
    expect(getLawdCd("충북", "청주시 흥덕구")).toBe("43113");
  });
  it("충남 천안시 서북구 → 44133", () => {
    expect(getLawdCd("충남", "천안시 서북구")).toBe("44133");
  });
  it("경북 포항시 북구 → 47113", () => {
    expect(getLawdCd("경북", "포항시 북구")).toBe("47113");
  });
  it("경남 창원시 의창구 → 48121", () => {
    expect(getLawdCd("경남", "창원시 의창구")).toBe("48121");
  });
  // 통합시 단독 구 형식 (apartments 원천 불일치 보정)
  it("충북 상당구 → 43111 (단독 구 매칭)", () => {
    expect(getLawdCd("충북", "상당구")).toBe("43111");
  });
  it("충남 동남구 → 44131 (단독 구 매칭)", () => {
    expect(getLawdCd("충남", "동남구")).toBe("44131");
  });
  it("경남 의창구 → 48121 (단독 구 매칭)", () => {
    expect(getLawdCd("경남", "의창구")).toBe("48121");
  });
  // 기존 광주 북구는 여전히 정확 매칭 (경북 북구와 충돌 없어야 함)
  it("광주 북구 → 29170 (단독 구 매칭 회귀 검증)", () => {
    expect(getLawdCd("광주", "북구")).toBe("29170");
  });
  // 경기 통합시 복합 gu (세션92-d)
  it("경기 수원시 영통구 → 41117", () => {
    expect(getLawdCd("경기", "수원시 영통구")).toBe("41117");
  });
  it("경기 성남시 분당구 → 41135", () => {
    expect(getLawdCd("경기", "성남시 분당구")).toBe("41135");
  });
  it("경기 고양시 덕양구 → 41281", () => {
    expect(getLawdCd("경기", "고양시 덕양구")).toBe("41281");
  });
  it("경기 용인시 기흥구 → 41463", () => {
    expect(getLawdCd("경기", "용인시 기흥구")).toBe("41463");
  });
  it("경기 부천시 소사구 → 41194", () => {
    expect(getLawdCd("경기", "부천시 소사구")).toBe("41194");
  });
  // 단독 구 경기 버전
  it("경기 영통구 → 41117 (단독 구 매칭)", () => {
    expect(getLawdCd("경기", "영통구")).toBe("41117");
  });
  it("미등록 군 → prefix 폴백", () => {
    expect(getLawdCd("경북", "미래군")).toBe("47000");
  });
});

describe("createReporter", () => {
  it("성공/실패 카운트를 정확히 집계한다", () => {
    const rpt = createReporter("test");
    rpt.success(5);
    rpt.fail(2);
    rpt.skip(1);
    const result = rpt.summary();
    expect(result.ok).toBe(5);
    expect(result.fail).toBe(2);
    expect(result.skip).toBe(1);
    expect(result.total).toBe(8);
  });
});

describe("sleep", () => {
  it("최소 지연 시간을 보장한다", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // 타이머 오차 허용
  });
});

describe("normalizeGu (세션95 단계 B)", () => {
  it("경기 화성시 동탄구 → 화성시 (복합 문자열)", () => {
    expect(normalizeGu("경기", "화성시 동탄구")).toBe("화성시");
  });
  it("경기 화성시 만세구/효행구/병점구 → 화성시", () => {
    expect(normalizeGu("경기", "화성시 만세구")).toBe("화성시");
    expect(normalizeGu("경기", "화성시 효행구")).toBe("화성시");
    expect(normalizeGu("경기", "화성시 병점구")).toBe("화성시");
  });
  it("경기 동탄구 단독 → 화성시 (비법정 구 화이트리스트)", () => {
    expect(normalizeGu("경기", "동탄구")).toBe("화성시");
  });
  it("경기 수원시 장안구 → 그대로 (법정 구)", () => {
    expect(normalizeGu("경기", "수원시 장안구")).toBe("수원시 장안구");
  });
  it("서울 강남구 → 그대로 (비경기 region)", () => {
    expect(normalizeGu("서울", "강남구")).toBe("강남구");
  });
  it("null/undefined gu → 그대로 (getLawdCd 호환)", () => {
    expect(normalizeGu("경기", null)).toBeNull();
    expect(normalizeGu("세종", undefined)).toBeUndefined();
  });
});

// 세션510 ① 수집기 — 전국 일반구 표기 통일. 진실의 원천 = src/data/sigungu-aliases.json
// 2026-08-11 운영 스냅샷(n=1,646) 실측: 같은 구가 두 표기로 갈린 쌍 28개 · 영향 266단지(16.2%).
// regions 쪽은 세 표기로 갈려 시군구 4지표가 310곳(19.4%)에서 값이 있는데도 "미수집"으로 떴다.
describe("normalizeGu — 전국 일반구 별칭표 (세션510)", () => {
  it("단독 구를 '시 구' 로 편다 — 이게 이번 사고의 본체다", () => {
    expect(normalizeGu("경기", "장안구")).toBe("수원시 장안구");
    expect(normalizeGu("경기", "처인구")).toBe("용인시 처인구");
    expect(normalizeGu("충북", "흥덕구")).toBe("청주시 흥덕구");
    expect(normalizeGu("경남", "성산구")).toBe("창원시 성산구");
  });

  it("이미 '시 구' 인 것은 그대로 (기존 동작 보존)", () => {
    expect(normalizeGu("경기", "수원시 장안구")).toBe("수원시 장안구");
    expect(normalizeGu("충남", "천안시 서북구")).toBe("천안시 서북구");
  });

  it("같은 이름 구가 여러 지역에 있어도 지역별로 갈린다 — '북구' 함정", () => {
    // 북구는 대구·부산·광주·울산에도 있다. 지역을 빼고 맞추면 포항 북구와 뒤섞인다.
    expect(normalizeGu("경북", "북구")).toBe("포항시 북구");
    expect(normalizeGu("대구", "북구")).toBe("북구"); // 광역시 자치구 — 손대지 않는다
    expect(normalizeGu("부산", "북구")).toBe("북구");
  });

  it("화성시 비법정구는 여전히 '화성시' 로 접는다 (세션94 규칙 유지)", () => {
    // 통계가 시 단위로만 나와서 구로 펴면 붙일 행이 없다.
    expect(normalizeGu("경기", "동탄구")).toBe("화성시");
    expect(normalizeGu("경기", "화성시 병점구")).toBe("화성시");
  });

  it("광역시 자치구는 대상이 아니다", () => {
    expect(normalizeGu("서울", "강남구")).toBe("강남구");
    expect(normalizeGu("인천", "연수구")).toBe("연수구");
  });
});

// 세션522 — 압축형("수원장안구") 전수 가드.
// 세션510 이 별칭표를 만들 때 forms 에 정식 2단("수원시 장안구")과 bare("장안구") 둘만 넣었다.
// 그런데 KOSIS/KAB·MOLIT 공시가격 CSV 는 **공백도 '시'도 없는 압축형**을 쓴다. 그게 표에 없으니
// normalizeGu 가 원문을 그대로 돌려줬고, 별칭표를 도입하고도 35개 도시 중 34개에서 무효였다
// (2026-08-22 라이브 실측: regions 에 압축형 행이 도시마다 2행씩 살아 있었다).
//
// 이 블록은 JSON 을 **직접 import 해서 전수 순회**한다 — 소스 정규식으로 세면 표가 늘 때
// 가드가 조용히 뒤처진다.
describe("normalizeGu — 압축형 별칭 전수 (세션522)", () => {
  it("모든 엔트리가 압축형·공백제거 form 을 갖는다", () => {
    // 압축형   = parentCity 에서 '시' 를 뗀 것 + 구명 ("수원장안구")  — KOSIS/KAB · MOLIT CSV 원문
    // 공백제거 = parentCity + 구명                  ("수원시장안구") — migration.normalizeC1Name 결과
    // 두 규칙 다 DB·수집기 실측에서 나온 실제 표기다.
    for (const e of GU_ALIAS_ENTRIES) {
      const guNames = guNamesOf(e);
      expect(guNames.length, `${e.region}|${e.canonical} 에 '시 구' 형 form 이 없다`).toBeGreaterThan(0);
      for (const g of guNames) {
        for (const want of [e.parentCity.replace(/시$/, "") + g, e.parentCity + g]) {
          expect(e.forms, `${e.region}|${e.canonical} 에 "${want}" 가 없다`).toContain(want);
        }
      }
    }
  });

  it("압축형·공백제거형이 canonical 로 접힌다 — 전 엔트리", () => {
    for (const e of GU_ALIAS_ENTRIES) {
      for (const g of guNamesOf(e)) {
        for (const f of [e.parentCity.replace(/시$/, "") + g, e.parentCity + g]) {
          expect(normalizeGu(e.region, f), `${e.region}|${f}`).toBe(e.canonical);
        }
      }
    }
  });

  it("forms 에 적힌 모든 표기가 canonical 로 접힌다 — 전 엔트리", () => {
    for (const e of GU_ALIAS_ENTRIES) {
      for (const f of e.forms) {
        expect(normalizeGu(e.region, f), `${e.region}|${f}`).toBe(e.canonical);
      }
    }
  });

  it("2026-08-22 라이브에서 실제로 관측된 압축형 표본", () => {
    // 표가 통째로 날아가도 이 줄들은 남아 사고를 재현한다.
    expect(normalizeGu("경기", "수원장안구")).toBe("수원시 장안구");
    expect(normalizeGu("경기", "성남분당구")).toBe("성남시 분당구");
    expect(normalizeGu("충북", "청주상당구")).toBe("청주시 상당구");
    expect(normalizeGu("경북", "포항남구")).toBe("포항시 남구");
    expect(normalizeGu("경남", "창원마산합포구")).toBe("창원시 마산합포구");
    expect(normalizeGu("경기", "화성동탄구")).toBe("화성시");
  });

  it("고양시 일산서구 — 형제 구는 등재됐는데 이것만 빠져 있었다 (세션522 발견)", () => {
    expect(normalizeGu("경기", "일산서구")).toBe("고양시 일산서구");
    expect(normalizeGu("경기", "고양일산서구")).toBe("고양시 일산서구");
    expect(guParentCity("경기", "고양일산서구")).toBe("고양시");
  });
});

describe("guParentCity — 시 단위 지표를 어느 시에 붙일지 (세션510)", () => {
  it("일반구의 부모 시를 돌려준다", () => {
    expect(guParentCity("경기", "장안구")).toBe("수원시");
    expect(guParentCity("경기", "수원시 장안구")).toBe("수원시");
    expect(guParentCity("경남", "마산회원구")).toBe("창원시");
  });

  it("광역시 자치구·미등재는 null — 추측으로 채우지 않는다", () => {
    // null 이 곧 "이 값을 시 단위로 쓸 수 없다"는 신호다. 호출부가 임의로 메우면 거짓이 된다.
    expect(guParentCity("서울", "강남구")).toBeNull();
    expect(guParentCity("경기", "없는구")).toBeNull();
    expect(guParentCity("경기", null)).toBeNull();
  });
});

describe("recordCollectorRun (수집기 모니터링 에픽 1단계)", () => {
  // fake Supabase 클라이언트 — insert 인자를 캡처. sbOverride 인자로 주입.
  /** @param {{ error?: unknown }} [insertResult] */
  function makeFakeSb(insertResult = { error: null }) {
    const insert = vi.fn(async () => insertResult);
    return {
      sb: /** @type {any} */ ({ from: vi.fn(() => ({ insert })) }),
      insert,
    };
  }

  it("summary() 결과를 collector_runs 에 올바르게 INSERT 한다", async () => {
    const { sb, insert } = makeFakeSb();
    await recordCollectorRun("molit-units", { elapsed: "3.2", ok: 10, fail: 0, skip: 2 }, sb);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      collector: "molit-units",
      status: "success",
      ok_count: 10,
      fail_count: 0,
      skip_count: 2,
      elapsed_sec: 3.2,
      error_message: null,
      started_at: null,
    });
  });

  it("fail > 0 이면 status 를 failure 로 자동 판정한다", async () => {
    const { sb, insert } = makeFakeSb();
    await recordCollectorRun("collect-trades", { ok: 5, fail: 3, skip: 0 }, sb);
    expect(/** @type {any[]} */ (insert.mock.calls[0])[0]).toMatchObject({ status: "failure", fail_count: 3 });
  });

  it("status 를 명시하면 (partial) 그대로 사용한다", async () => {
    const { sb, insert } = makeFakeSb();
    await recordCollectorRun("schools-neis", { status: "partial", ok: 8, fail: 1 }, sb);
    expect(/** @type {any[]} */ (insert.mock.calls[0])[0]).toMatchObject({ status: "partial" });
  });

  it("insert 가 error 를 반환해도 throw 하지 않는다", async () => {
    const { sb } = makeFakeSb({ error: { message: "DB 연결 실패" } });
    await expect(
      recordCollectorRun("population", { ok: 1, fail: 0 }, sb)
    ).resolves.toBeUndefined();
  });

  it("--dry-run argv 있으면 sbOverride 없이 getSupabase 호출 안 함 (INSERT skip)", async () => {
    // dry-run 가드가 동작하면: console.log 에 'dry-run 기록 skip' 만 찍히고
    // getSupabase() 까지 도달 안 함 → SUPABASE 키 부재 에러(console.error)가 없어야 함.
    // 가드를 되돌리면 getSupabase() 가 throw → console.error 에 'SUPABASE' 메시지 발생 → 두 expect 모두 FAIL.
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    /** @type {string[]} */
    let logMsgs = [];
    /** @type {string[]} */
    let errMsgs = [];
    try {
      await recordCollectorRun("dry-test", { ok: 0 });
    } finally {
      logMsgs = logSpy.mock.calls.map(c => c.join(" "));
      errMsgs = errSpy.mock.calls.map(c => c.join(" "));
      process.argv = orig;
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
    // dry-run skip 메시지가 찍혔다 = 조기 return 경로 진입
    expect(logMsgs.some(m => m.includes("dry-run"))).toBe(true);
    // SUPABASE 키 부재 에러가 없다 = getSupabase() 미호출 (DB 접근 시도 안 함)
    expect(errMsgs.some(m => m.includes("SUPABASE"))).toBe(false);
  });

  it("--dry-run argv 있어도 sbOverride 주입 시 INSERT 수행 (테스트 격리)", async () => {
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    try {
      await recordCollectorRun("dry-test", { ok: 5 }, sb);
    } finally {
      process.argv = orig;
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].collector).toBe("dry-test");
  });
});

describe("recordApiQuota (dry-run 가드)", () => {
  it("sbOverride 주입 시 api_quota_log 에 INSERT", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    await recordApiQuota("quota-test", "TEST_KEY", 5, sb);
    expect(rows).toHaveLength(1);
    expect(rows[0].collector).toBe("quota-test");
    expect(rows[0].call_count).toBe(5);
  });

  it("callCount 0 이면 INSERT 안 함 (기존 가드 유지)", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    await recordApiQuota("quota-test", "TEST_KEY", 0, sb);
    expect(rows).toHaveLength(0);
  });

  it("--dry-run argv 있으면 sbOverride 없이 getSupabase 호출 안 함 (console spy)", async () => {
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await recordApiQuota("quota-test", "TEST_KEY", 5);
    } finally {
      process.argv = orig;
    }
    const logMsgs = logSpy.mock.calls.map((c) => c.join(" "));
    const errMsgs = errSpy.mock.calls.map((c) => c.join(" "));
    logSpy.mockRestore();
    errSpy.mockRestore();
    expect(logMsgs.some((m) => m.includes("dry-run"))).toBe(true);
    expect(errMsgs.some((m) => m.includes("SUPABASE"))).toBe(false);
  });
});

// 세션 327: graceful shutdown 단위 테스트 신규 (PR #28 회귀 가드)
describe("setupGracefulShutdown", () => {
  it("SIGTERM 받기 전에는 interrupted=false", () => {
    const isInterrupted = setupGracefulShutdown("test-setup-1");
    expect(isInterrupted()).toBe(false);
  });

  it("SIGTERM emit 후 interrupted=true", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const isInterrupted = setupGracefulShutdown("test-setup-2");
    expect(isInterrupted()).toBe(false);
    process.emit("SIGTERM");
    expect(isInterrupted()).toBe(true);
    logSpy.mockRestore();
  });
});

describe("createReporter graceful shutdown", () => {
  it("SIGTERM 받기 전에는 rpt.interrupted()=false + summary.status=success", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const rpt = createReporter("test-rpt-1");
    rpt.success(10);
    expect(rpt.interrupted()).toBe(false);
    const sum = rpt.summary();
    expect(sum.status).toBe("success");
    expect(sum.ok).toBe(10);
    logSpy.mockRestore();
  });

  it("SIGTERM emit 후 rpt.interrupted()=true + summary.status=partial", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const rpt = createReporter("test-rpt-2");
    rpt.success(5);
    process.emit("SIGTERM");
    expect(rpt.interrupted()).toBe(true);
    const sum = rpt.summary();
    expect(sum.status).toBe("partial");
    expect(sum.ok).toBe(5);
    logSpy.mockRestore();
  });
});

// ── budgetExceeded — job timeout 전에 스스로 멈추는 벽시계 예산 (세션 490) ──
describe("budgetExceeded — 벽시계 예산", () => {
  const T0 = Date.parse("2026-08-05T00:00:00Z");
  const min = (/** @type {number} */ n) => T0 + n * 60_000;

  it("예산 미만이면 false", () => {
    expect(budgetExceeded(T0, 150, min(149))).toBe(false);
  });

  it("예산 정확히 도달하면 true (경계 포함)", () => {
    expect(budgetExceeded(T0, 150, min(150))).toBe(true);
  });

  it("예산 초과면 true", () => {
    expect(budgetExceeded(T0, 150, min(151))).toBe(true);
  });

  it("budgetMin=0 은 비활성 — 아무리 지나도 false", () => {
    expect(budgetExceeded(T0, 0, min(100000))).toBe(false);
  });

  it("budgetMin 음수도 비활성", () => {
    expect(budgetExceeded(T0, -5, min(100000))).toBe(false);
  });

  it("시작 직후는 false", () => {
    expect(budgetExceeded(T0, 150, T0)).toBe(false);
  });
});

// 세션 496: fetchWithRetry 가 호출자의 signal 을 무조건 AbortSignal.timeout(30000) 으로
// 덮어쓰던 결함. transport-tago 의 searchBusStopsTago 가 15000ms 짧은 timeout 을 넘겨도
// 조용히 무시돼 30초로 늘어나던 것을 잡는 회귀 가드. 46개 수집기가 공유하는 함수라
// "호출자 미지정 시 30초 기본값 유지"도 함께 검증한다.
describe("fetchWithRetry — AbortSignal (세션 496: 호출자 signal 존중, 기본값 회귀 없음)", () => {
  const originalFetch = global.fetch;

  it("호출자가 signal 을 넘기면 fetch 에 그 signal 이 그대로 전달된다 (덮어쓰기 금지)", async () => {
    /** @type {AbortSignal | undefined} */
    let receivedSignal;
    global.fetch = /** @type {any} */ (vi.fn(async (_url, opts) => {
      receivedSignal = opts.signal;
      return { ok: true, json: async () => ({}) };
    }));
    try {
      const callerSignal = AbortSignal.timeout(15000);
      await fetchWithRetry("https://example.com", { signal: callerSignal });
      expect(receivedSignal).toBe(callerSignal);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("호출자가 signal 을 안 넘기면 fetch 는 AbortSignal 인스턴스를 받는다 (30초 기본값 유지)", async () => {
    /** @type {any} */
    let receivedSignal;
    global.fetch = /** @type {any} */ (vi.fn(async (_url, opts) => {
      receivedSignal = opts.signal;
      return { ok: true, json: async () => ({}) };
    }));
    try {
      await fetchWithRetry("https://example.com", { headers: { "X-Test": "1" } });
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("options 자체를 안 넘겨도(기본 {}) 여전히 AbortSignal 기본값이 붙는다", async () => {
    /** @type {any} */
    let receivedSignal;
    global.fetch = /** @type {any} */ (vi.fn(async (_url, opts) => {
      receivedSignal = opts.signal;
      return { ok: true, json: async () => ({}) };
    }));
    try {
      await fetchWithRetry("https://example.com");
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── resolveBuilder 3벌 동기화 대조 (세션515) ──────────────────
//
// 같은 건설사명을 수집기(`_shared.mjs`)와 화면(`src/constants/brands.ts`)이 다르게 해석하면
// 저장 표기와 등급 조회가 어긋난다. 세션513이 정본만 정규화 폴백을 갖도록 고쳐 사본이 뒤처져
// 있던 것을 잇는 자리라, **두 구현이 같은 답을 내는지**를 여기서 잠근다.
describe("resolveBuilder — brands.ts 정본과 동기화", () => {
  const canonicals = Object.keys(BRAND_TIER);

  // 법인격·공백 변형까지 만들어야 "정규화 폴백이 살아 있는가"를 실제로 묻게 된다.
  // 정식 이름만 넣으면 열거식 사본으로 되돌려도 통과해 가드가 껍데기가 된다.
  /** @param {string} c @returns {string[]} */
  const variants = (c) => [
    c, `(주)${c}`, `${c}(주)`, `주식회사 ${c}`, `㈜${c}`,
    c.length > 2 ? `${c.slice(0, 2)} ${c.slice(2)}` : `${c} `,
  ];

  /** @type {string[]} */
  const corpus = [...new Set([
    ...Object.keys(BRANDS_BUILDER_ALIASES),
    ...Object.keys(BUILDER_ALIASES),
    ...canonicals,
    ...canonicals.flatMap(variants),
  ])];

  it("코퍼스 전 항목에서 두 구현의 출력이 같다", () => {
    /** @type {Array<[string, string, string]>} */
    const mismatches = [];
    for (const name of corpus) {
      const mine = resolveBuilder(name);
      const theirs = brandsResolveBuilder(name);
      if (mine !== theirs) mismatches.push([name, mine, theirs]);
    }
    expect(mismatches).toEqual([]);
  });

  it("코퍼스가 법인격 변형을 실제로 담고 있다(가드가 껍데기가 되는 것 차단)", () => {
    expect(corpus.length).toBeGreaterThan(canonicals.length * 5);
    expect(corpus).toContain("주식회사 GS건설");
  });

  it("BUILDER_ALIASES 표가 양쪽 동일하다", () => {
    expect(BUILDER_ALIASES).toEqual(BRANDS_BUILDER_ALIASES);
  });

  it("BUILDER_CANONICALS 가 BRAND_TIER 키 목록과 동일하다", () => {
    expect([...BUILDER_CANONICALS]).toEqual(canonicals);
  });

  it("null·빈 문자열은 양쪽 다 '기타'", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(resolveBuilder(empty)).toBe(brandsResolveBuilder(empty));
    }
    expect(resolveBuilder(null)).toBe("기타");
    expect(resolveBuilder("")).toBe("기타");
  });
});
