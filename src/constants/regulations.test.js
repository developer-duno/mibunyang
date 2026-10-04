// @ts-check
/**
 * regulations 상수 테스트
 *
 * 규제지역 판별 및 LTV 대출한도 계산 로직을 검증합니다.
 * - getZone: src/data/regulation-zones.json 에서 파생된 ZONE_MAP 조회
 * - zoneOf: DB 규제 표시(isRegulated) 우선, 비었으면 getZone
 * - calcLTV: 규제지역 40% + 금액 캡 / 비규제 70% / 수도권 최대 6억
 *   (금융위 10·15 대책 FAQ · 2025-06-28 시행 수도권 주담대 6억 한도)
 */
import { describe, it, expect } from "vitest";
import {
  getZone,
  zoneOf,
  isMetroRegion,
  calcLTV,
  ZONE_MAP,
  ZONE_TYPE,
  NORMAL_LTV,
  REGULATED_LTV_RATE,
  REGULATED_LTV_CAPS,
  METRO_LOAN_CAP,
  METRO_REGIONS,
} from "@/constants/regulations";
import zonesJson from "../data/regulation-zones.json";

// 10·15 대책 지정 경기 12곳 (공식 표기)
const GYEONGGI_12 = [
  "과천시",
  "광명시",
  "성남시 분당구",
  "성남시 수정구",
  "성남시 중원구",
  "수원시 영통구",
  "수원시 장안구",
  "수원시 팔달구",
  "안양시 동안구",
  "용인시 수지구",
  "의왕시",
  "하남시",
];

// 2026-06-30 국토부 발표 · 2026-07-01 효력 추가 지정 3곳 (정책브리핑 148967354)
const GYEONGGI_ADDED_2026_07 = ["화성시 동탄구", "용인시 기흥구", "구리시"];

describe("ZONE_MAP — JSON 파생 (손으로 적은 지역이 없어야 한다)", () => {
  it("비어 있지 않다 (빈 리터럴로 되돌아가면 화면이 전국을 비규제로 안내한다)", () => {
    expect(Object.keys(ZONE_MAP).length).toBeGreaterThan(0);
  });

  it("JSON 의 모든 항목이 조회 키로 들어와 있다", () => {
    const entries = [...zonesJson["투기과열지구"], ...zonesJson["조정대상지역"], ...zonesJson["_guAliases"]];
    for (const e of entries) {
      const sp = e.indexOf(" ");
      const key = sp === -1 ? e : `${e.slice(0, sp)}:${e.slice(sp + 1)}`;
      expect(ZONE_MAP[key]).toBe("overheated");
    }
  });
});

describe("regulation-zones.json — 라벨 진실성 가드", () => {
  // ZONE_TYPE.overheated 라벨("규제지역")은 두 규제가 같은 곳에 겹쳐 있다는 전제 위에 있다.
  // 목록이 갈라지면 그 라벨이 한쪽을 숨기는 거짓이 되므로, 갈라지는 순간을 여기서 잡는다.
  it("투기과열지구와 조정대상지역 목록이 동일하다 (10·15 · 2026-07-01 모두 동시 지정)", () => {
    expect([...zonesJson["투기과열지구"]].sort()).toEqual([...zonesJson["조정대상지역"]].sort());
  });

  it("서울은 시도 전역 한 항목으로 지정한다 (구 25개 나열 금지 — gu 표기 흔들림 회피)", () => {
    expect(zonesJson["투기과열지구"]).toContain("서울");
    expect(zonesJson["투기과열지구"].filter((z) => z.startsWith("서울 "))).toHaveLength(0);
  });

  it("경기 12곳 + 2026-07-01 추가 3곳이 공식 표기로 전부 들어 있다", () => {
    for (const gu of [...GYEONGGI_12, ...GYEONGGI_ADDED_2026_07]) {
      expect(zonesJson["투기과열지구"]).toContain(`경기 ${gu}`);
    }
    // 서울 1 + 경기 12 + 경기 3 = 16
    expect(zonesJson["투기과열지구"]).toHaveLength(16);
  });

  it("화성시 동탄구 법정동코드 규칙(41597)이 있고, 그 이름이 규제 목록에 들어 있다", () => {
    // 41597 = 화성시 동탄구 (scripts/collectors/_shared.mjs HWASEONG_LAWD_CODES 주석 순서)
    expect(zonesJson["_bjdPrefixZones"]).toEqual({ 41597: "경기 화성시 동탄구" });
    expect(zonesJson["투기과열지구"]).toContain(zonesJson["_bjdPrefixZones"]["41597"]);
  });
});

describe("getZone — 규제지역", () => {
  // 서울 전역 지정 → 25개 구 아무거나 규제
  it.each(["강남구", "서초구", "송파구", "용산구", "양천구", "노원구", "중랑구", "금천구"])(
    "서울 %s → 규제지역",
    (gu) => {
      expect(getZone("서울", gu)).toBe("overheated");
    }
  );

  it.each(GYEONGGI_12)("경기 %s → 규제지역", (gu) => {
    expect(getZone("경기", gu)).toBe("overheated");
  });

  // "기흥구" = 시 이름 없는 DB 표기 흡수(_guAliases, 수지구와 짝 — 세션592 보완 F5)
  it.each(["구리시", "용인시 기흥구", "기흥구"])("경기 %s (2026-07-01 추가) → 규제지역", (gu) => {
    expect(getZone("경기", gu)).toBe("overheated");
  });

  // DB 가 시 이름 없이 저장한 표기(2026-08-09 실측 5종 + 방어 3종)도 같이 잡혀야 한다
  it.each(["분당구", "수정구", "중원구", "영통구", "장안구", "팔달구", "동안구", "수지구"])(
    "경기 %s (시 이름 없는 DB 표기) → 규제지역",
    (gu) => {
      expect(getZone("경기", gu)).toBe("overheated");
    }
  );

  it("서울은 gu 가 비어 있어도 규제지역 (시도 단독 폴백)", () => {
    expect(getZone("서울", null)).toBe("overheated");
    expect(getZone("서울", "")).toBe("overheated");
  });
});

describe("getZone — 비규제지역", () => {
  it.each([
    ["부산", "해운대구"],
    ["대구", "수성구"],
    ["인천", "연수구"],
    ["대전", "유성구"],
    ["광주", "광산구"],
    ["세종", ""],
    ["경기", "평택시"],
    // 화성시 **전체**는 지정이 아니다(동탄구만). DB gu 가 "화성시" 하나라 이름으로는 못 가르고,
    // 동탄구는 수집기가 법정동코드로 판정해 DB is_regulated 에 적는다 → 화면은 zoneOf 로 그 값을 먼저 본다.
    ["경기", "화성시"],
    ["경기", "고양시 덕양구"],
    ["경기", "용인시 처인구"], // 같은 용인시라도 수지구·기흥구만 지정됐다
    ["경기", "안양시 만안구"], // 같은 안양시라도 동안구만 지정됐다
    ["경기", "수원시 권선구"], // 같은 수원시라도 권선구는 빠졌다
  ])("%s %s → normal", (region, gu) => {
    expect(getZone(region, gu)).toBe("normal");
  });

  it("null/undefined 입력 시에도 normal을 반환한다", () => {
    expect(getZone(null, null)).toBe("normal");
    expect(getZone(undefined, undefined)).toBe("normal");
    expect(getZone("", "")).toBe("normal");
  });

  it("복합 region 값에서 첫 번째 값만 사용한다", () => {
    // "경기 수원시"는 구 단위 지정이라 시 단독 표기로는 규제가 아니다
    expect(getZone("경기,서울,인천", "수원시")).toBe("normal");
    // 첫 값이 서울이면 규제
    expect(getZone("서울,경기", "강남구")).toBe("overheated");
  });
});

describe("zoneOf — DB 규제 표시가 이름 조회보다 먼저다 (점수 scoreRisk 와 같은 순서)", () => {
  it("DB 참 + 이름은 비규제(화성시 동탄 행) → 규제지역", () => {
    expect(zoneOf({ isRegulated: true, region: "경기", gu: "화성시" })).toBe("overheated");
  });

  it("DB 거짓 + 이름은 규제(서울) → 비규제", () => {
    expect(zoneOf({ isRegulated: false, region: "서울", gu: "강남구" })).toBe("normal");
  });

  it("DB 값이 비었으면 이름 조회로", () => {
    expect(zoneOf({ isRegulated: null, region: "경기", gu: "구리시" })).toBe("overheated");
    expect(zoneOf({ region: "부산", gu: "해운대구" })).toBe("normal");
  });
});

describe("isMetroRegion — 수도권(서울·경기·인천)", () => {
  it.each([
    ["서울", true],
    ["경기", true],
    ["인천", true],
    ["부산", false],
    ["세종", false],
    ["", false],
    [null, false],
  ])("%s → %s", (region, want) => {
    expect(isMetroRegion(region)).toBe(want);
  });

  it("복합값은 getZone 처럼 첫 값으로 본다", () => {
    expect(isMetroRegion("경기,서울")).toBe(true);
    expect(isMetroRegion("부산,경기")).toBe(false);
  });
});

describe("calcLTV — 규제지역 (40% + 금액 캡)", () => {
  it("10억: 40% 그대로 4억", () => {
    expect(calcLTV(100000, "overheated", "서울")).toBe(40000);
  });

  it("12억: 40% 그대로 4.8억", () => {
    expect(calcLTV(120000, "overheated", "서울")).toBe(48000);
  });

  it("15억(캡 경계 자체): 아직 캡 없음 → 6억", () => {
    expect(calcLTV(150000, "overheated", "서울")).toBe(60000);
  });

  it("20억: 8억이 아니라 캡 4억", () => {
    expect(calcLTV(200000, "overheated", "서울")).toBe(40000);
  });

  it("25억(캡 경계 자체): 4억 구간 유지 (10억 → 캡 4억)", () => {
    expect(calcLTV(250000, "overheated", "서울")).toBe(40000);
  });

  it("30억: 12억이 아니라 캡 2억", () => {
    expect(calcLTV(300000, "overheated", "서울")).toBe(20000);
  });

  it("15억 이하는 캡 구간에 들어가지 않는다 (5억 → 2억 · 5.64억 → 2.256억)", () => {
    expect(calcLTV(50000, "overheated", "서울")).toBe(20000);
    expect(calcLTV(56400, "overheated", "경기")).toBe(22560);
  });

  it("speculative 도 같은 규제 규칙을 쓴다", () => {
    expect(calcLTV(200000, "speculative", "서울")).toBe(40000);
    expect(calcLTV(100000, "speculative", "서울")).toBe(40000);
  });

  it("가격 없음/0 → 0", () => {
    expect(calcLTV(null, "overheated", "서울")).toBe(0);
    expect(calcLTV(undefined, "overheated", "서울")).toBe(0);
    expect(calcLTV(0, "overheated", "서울")).toBe(0);
  });
});

describe("calcLTV — 비규제지역 (70% 하나)", () => {
  it("지방 5억 → 3.5억 (70%)", () => {
    expect(calcLTV(50000, "normal", "부산")).toBe(35000);
  });

  it("지방 10억 → 7억 (옛 9억 나눔이면 6.9억이었다)", () => {
    expect(calcLTV(100000, "normal", "부산")).toBe(70000);
  });

  it("지방 비규제는 금액 한도가 없다 (30억 → 21억)", () => {
    expect(calcLTV(300000, "normal", "강원")).toBe(210000);
  });

  it("9억 경계에서 끊기지 않는다 (89,999·90,001 모두 70%)", () => {
    expect(calcLTV(89999, "normal", "부산")).toBe(Math.round(89999 * 0.7));
    expect(calcLTV(90001, "normal", "부산")).toBe(Math.round(90001 * 0.7));
  });
});

describe("calcLTV — 수도권 주택구입 대출 최대 6억 (2025-06-28 시행)", () => {
  it("경기 비규제 10억 → 7억이 아니라 6억", () => {
    expect(calcLTV(100000, "normal", "경기")).toBe(60000);
  });

  it("인천 비규제 9억 → 6.3억이 아니라 6억", () => {
    expect(calcLTV(90000, "normal", "인천")).toBe(60000);
  });

  it("경기 비규제 5.64억 → 3.948억 (6억 아래라 그대로 70%)", () => {
    expect(calcLTV(56400, "normal", "경기")).toBe(39480);
  });

  it("서울이 DB 상 비규제로 와도 6억 한도는 걸린다 (구역과 무관)", () => {
    expect(calcLTV(120000, "normal", "서울")).toBe(60000);
  });

  it("6억 경계 — 70% 가 6억을 조금 넘으면 6억, 조금 못 미치면 그대로", () => {
    expect(calcLTV(85800, "normal", "경기")).toBe(60000); // 70% = 6억60만
    expect(calcLTV(85700, "normal", "경기")).toBe(59990); // 70% = 5억9,990만
  });

  it("복합 region 은 첫 값 — '부산,경기' 는 지방", () => {
    expect(calcLTV(100000, "normal", "부산,경기")).toBe(70000);
  });

  it("region 이 없으면 수도권으로 보지 않는다", () => {
    expect(calcLTV(100000, "normal", null)).toBe(70000);
  });
});

describe("calcLTV — getZone 과 이어 붙였을 때", () => {
  it("서울 20억 단지는 캡 4억", () => {
    expect(calcLTV(200000, getZone("서울", "강남구"), "서울")).toBe(40000);
  });

  it("부산 20억 단지는 비규제 70% = 14억", () => {
    expect(calcLTV(200000, getZone("부산", "해운대구"), "부산")).toBe(140000);
  });

  it("구리시 10억 단지는 2026-07-01 부터 규제 40% = 4억", () => {
    expect(calcLTV(100000, getZone("경기", "구리시"), "경기")).toBe(40000);
  });
});

describe("상수", () => {
  it("ZONE_TYPE 3종 — overheated 는 두 규제를 아우르는 '규제지역'", () => {
    expect(Object.keys(ZONE_TYPE)).toHaveLength(3);
    expect(ZONE_TYPE.speculative).toBe("투기과열지구");
    expect(ZONE_TYPE.overheated).toBe("규제지역");
    expect(ZONE_TYPE.normal).toBe("비규제지역");
  });

  it("규제지역 비율 40%, 비규제 70%, 수도권 한도 6억", () => {
    expect(REGULATED_LTV_RATE).toBe(0.4);
    expect(NORMAL_LTV).toBe(0.7);
    expect(METRO_LOAN_CAP).toBe(60000);
    expect([...METRO_REGIONS].sort()).toEqual(["경기", "서울", "인천"].sort());
  });

  it("캡은 비싼 구간부터 정렬돼 있다 (find 가 먼저 만나는 쪽이 이긴다)", () => {
    const prices = REGULATED_LTV_CAPS.map((c) => c.overPrice);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(REGULATED_LTV_CAPS).toEqual([
      { overPrice: 250000, cap: 20000 },
      { overPrice: 150000, cap: 40000 },
    ]);
  });
});
