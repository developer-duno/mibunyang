// @ts-check
/**
 * regulations 상수 테스트
 *
 * 규제지역 판별 및 LTV 대출한도 계산 로직을 검증합니다.
 * - getZone: src/data/regulation-zones.json 에서 파생된 ZONE_MAP 조회
 * - calcLTV: 규제지역 40% + 금액 캡 / 비규제 9억 차등 (2025 10·15 대책)
 */
import { describe, it, expect } from "vitest";
import {
  getZone,
  calcLTV,
  ZONE_MAP,
  ZONE_TYPE,
  NORMAL_LTV,
  REGULATED_LTV_RATE,
  REGULATED_LTV_CAPS,
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
  it("투기과열지구와 조정대상지역 목록이 동일하다 (10·15 동시 지정)", () => {
    expect([...zonesJson["투기과열지구"]].sort()).toEqual([...zonesJson["조정대상지역"]].sort());
  });

  it("서울은 시도 전역 한 항목으로 지정한다 (구 25개 나열 금지 — gu 표기 흔들림 회피)", () => {
    expect(zonesJson["투기과열지구"]).toContain("서울");
    expect(zonesJson["투기과열지구"].filter((z) => z.startsWith("서울 "))).toHaveLength(0);
  });

  it("경기 12곳이 공식 표기로 전부 들어 있다", () => {
    for (const gu of GYEONGGI_12) {
      expect(zonesJson["투기과열지구"]).toContain(`경기 ${gu}`);
    }
    // 서울 1 + 경기 12 = 13
    expect(zonesJson["투기과열지구"]).toHaveLength(13);
  });
});

describe("getZone — 10·15 규제지역", () => {
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
    ["경기", "화성시"],
    ["경기", "고양시 덕양구"],
    ["경기", "용인시 처인구"], // 같은 용인시라도 수지구만 지정됐다
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

describe("calcLTV — 규제지역 (40% + 금액 캡)", () => {
  it("10억: 40% 그대로 4억", () => {
    expect(calcLTV(100000, "overheated")).toBe(40000);
  });

  it("15억(캡 경계 자체): 아직 캡 없음 → 6억", () => {
    expect(calcLTV(150000, "overheated")).toBe(60000);
  });

  it("20억: 8억이 아니라 캡 4억", () => {
    expect(calcLTV(200000, "overheated")).toBe(40000);
  });

  it("25억(캡 경계 자체): 4억 구간 유지 (10억 → 캡 4억)", () => {
    expect(calcLTV(250000, "overheated")).toBe(40000);
  });

  it("30억: 12억이 아니라 캡 2억", () => {
    expect(calcLTV(300000, "overheated")).toBe(20000);
  });

  it("15억 이하는 캡 구간에 들어가지 않는다 (5억 → 2억)", () => {
    expect(calcLTV(50000, "overheated")).toBe(20000);
  });

  it("speculative 도 같은 규제 규칙을 쓴다", () => {
    expect(calcLTV(200000, "speculative")).toBe(40000);
    expect(calcLTV(100000, "speculative")).toBe(40000);
  });

  it("가격 없음/0 → 0", () => {
    expect(calcLTV(null, "overheated")).toBe(0);
    expect(calcLTV(undefined, "overheated")).toBe(0);
    expect(calcLTV(0, "overheated")).toBe(0);
  });
});

describe("calcLTV — 비규제지역 (종전 9억 차등 유지)", () => {
  it("9억 이하: price * 0.70", () => {
    expect(calcLTV(50000, "normal")).toBe(Math.round(50000 * 0.7));
  });

  it("9억 초과: 9억 * 0.70 + 초과분 * 0.60", () => {
    expect(calcLTV(120000, "normal")).toBe(Math.round(90000 * 0.7 + 30000 * 0.6));
  });

  it("정확히 9억은 이하 구간", () => {
    expect(calcLTV(90000, "normal")).toBe(Math.round(90000 * 0.7));
  });

  it("9억 경계 ±1만원", () => {
    expect(calcLTV(89999, "normal")).toBe(Math.round(89999 * 0.7));
    expect(calcLTV(90001, "normal")).toBe(Math.round(90000 * 0.7 + 1 * 0.6));
  });

  it("비규제는 금액 캡이 없다 (30억이어도 잘리지 않는다)", () => {
    expect(calcLTV(300000, "normal")).toBe(Math.round(90000 * 0.7 + 210000 * 0.6));
  });
});

describe("calcLTV — getZone 과 이어 붙였을 때", () => {
  it("서울 20억 단지는 캡 4억", () => {
    expect(calcLTV(200000, getZone("서울", "강남구"))).toBe(40000);
  });

  it("부산 20억 단지는 비규제 계산", () => {
    expect(calcLTV(200000, getZone("부산", "해운대구"))).toBe(Math.round(90000 * 0.7 + 110000 * 0.6));
  });
});

describe("상수", () => {
  it("ZONE_TYPE 3종 — overheated 는 두 규제를 아우르는 '규제지역'", () => {
    expect(Object.keys(ZONE_TYPE)).toHaveLength(3);
    expect(ZONE_TYPE.speculative).toBe("투기과열지구");
    expect(ZONE_TYPE.overheated).toBe("규제지역");
    expect(ZONE_TYPE.normal).toBe("비규제지역");
  });

  it("규제지역 비율 40%, 비규제 70/60", () => {
    expect(REGULATED_LTV_RATE).toBe(0.4);
    expect(NORMAL_LTV.under).toBe(0.7);
    expect(NORMAL_LTV.over).toBe(0.6);
    expect(NORMAL_LTV.threshold).toBe(90000);
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
