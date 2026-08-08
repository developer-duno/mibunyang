import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistanceDots, fmtDist } from "./DistanceDots";
import { DISTANCE_AXES } from "@/constants/distanceAxes";
import type { Apt } from "@/types/scoring";

function apt(over: Record<string, unknown> = {}): Apt {
  return {
    convDist: 100,
    cafeDist: 200,
    pharmacyDist: 300,
    childcareDist: 400,
    cultureDist: 500,
    hospitalDist: 600,
    parkDist: 700,
    bankDist: 800,
    martDist: 900,
    subwayDist: 1200,
    policeDist: 2000,
    emergencyDist: 3000,
    ...over,
  } as unknown as Apt;
}

describe("DistanceDots — 축 구성", () => {
  it("자릿수가 다른 거리를 축 3개로 나눈다", () => {
    expect(DISTANCE_AXES).toHaveLength(3);
    expect(DISTANCE_AXES.map((a) => a.cap)).toEqual([500, 1000, 10000]);
  });

  it("한 축 안의 필드는 실측 최댓값이 그 축 상한 안에 든다", () => {
    // 실측(2026-08-03): 편의점 491 · 카페 499 · 약국 498 / 어린이집 983 · 문화 997 ·
    // 병원 989 · 공원 998 · 은행 998 · 마트 999 / 지하철 9484 · 경찰 2971
    const MEASURED_MAX: Record<string, number> = {
      convDist: 491,
      cafeDist: 499,
      pharmacyDist: 498,
      childcareDist: 983,
      cultureDist: 997,
      hospitalDist: 989,
      parkDist: 998,
      bankDist: 998,
      martDist: 999,
      subwayDist: 9484,
      policeDist: 2971,
    };
    for (const ax of DISTANCE_AXES) {
      for (const it of ax.items) {
        const m = MEASURED_MAX[it.field];
        if (m == null) continue; // emergencyDist 는 69,072 라 축 밖 표시로 처리
        expect(m, `${it.field}(최대 ${m}m)가 ${ax.cap}m 축에 안 맞는다`).toBeLessThanOrEqual(ax.cap);
      }
    }
  });
});

describe("DistanceDots — 일부러 뺀 필드", () => {
  const fields = DISTANCE_AXES.flatMap((a) => a.items.map((i) => i.field));

  // ⚠️ 옛 사유("채움 0.0%"·"3.9%")는 세션 499 수집 정정으로 거짓이 됐다(KTX 71.8%·IC 79.2%).
  //    남은 진짜 사유는 **단위**뿐이다 — 둘 다 km 라 m 축에 그대로 올릴 수 없다.
  it("ktxDist 는 넣지 않는다 — 단위가 km 라 m 축에 섞으면 안 된다", () => {
    expect(fields, "단위가 다른 필드(km)를 m 축에 올렸다").not.toContain("ktxDist");
  });

  it("icDist 는 넣지 않는다 — 단위가 km 라 m 축에 섞으면 안 된다", () => {
    expect(fields, "단위가 다른 필드(km)를 m 축에 올렸다").not.toContain("icDist");
  });

  it("noxiousDist 는 넣지 않는다 — 멀수록 좋은 유일한 필드라 방향이 반대다", () => {
    expect(fields, "'왼쪽일수록 좋다' 규칙과 방향이 반대인 필드를 섞었다").not.toContain("noxiousDist");
  });
});

describe("DistanceDots — 렌더", () => {
  it("자료가 있으면 시설 이름과 거리를 보여준다", () => {
    render(<DistanceDots apt={apt()} />);
    expect(screen.getByText("편의점")).toBeInTheDocument();
    expect(screen.getByText("100m")).toBeInTheDocument();
    expect(screen.getByText("1.2km")).toBeInTheDocument(); // 지하철 1200m
  });

  it("값이 없는 시설은 '미수집'으로 자리를 지킨다 (행이 사라지지 않는다)", () => {
    render(<DistanceDots apt={apt({ martDist: null, bankDist: null })} />);
    expect(screen.getAllByText("미수집")).toHaveLength(2);
    expect(screen.getByText("마트")).toBeInTheDocument();
  });

  it("센티널(지하철 9999)은 값이 아니라 미수집으로 본다", () => {
    render(<DistanceDots apt={apt({ subwayDist: 9999 })} />);
    expect(screen.getByText("지하철역")).toBeInTheDocument();
    expect(screen.getAllByText("미수집").length).toBeGreaterThan(0);
  });

  it("전부 비면 왜 없는지 말한다 (고장난 줄 알지 않게)", () => {
    const empty = Object.fromEntries(DISTANCE_AXES.flatMap((a) => a.items.map((i) => [i.field, null])));
    render(<DistanceDots apt={empty as unknown as Apt} />);
    expect(screen.getByText(/아직 모으지 못했어요/)).toBeInTheDocument();
  });

  it("축을 넘는 값(응급의료 69km)도 자리를 지키고 실제 값을 적는다", () => {
    render(<DistanceDots apt={apt({ emergencyDist: 69072 })} />);
    expect(screen.getByText("69.1km")).toBeInTheDocument();
  });
});

describe("DistanceDots — 개수 병기 (세션 505)", () => {
  it("개수가 있으면 라벨에 함께 적는다 (표를 없애고 이 한 줄로 합쳤다)", () => {
    render(<DistanceDots apt={apt({ hospital: 3, conv: 12 })} />);
    expect(screen.getByText("병원 3곳")).toBeInTheDocument();
    expect(screen.getByText("편의점 12곳")).toBeInTheDocument();
  });

  it("개수가 없거나 0이면 옛 라벨 그대로 둔다 ('0곳'이라 단정하지 않는다)", () => {
    // 0 은 '한 곳도 없다'인지 '아직 안 모았다'인지 이 값만으로 못 가른다.
    render(<DistanceDots apt={apt({ hospital: 0, mart: null })} />);
    expect(screen.getByText("병원")).toBeInTheDocument();
    expect(screen.getByText("마트")).toBeInTheDocument();
  });

  it("지하철역은 개수 필드가 없어 언제나 이름만 나온다", () => {
    render(<DistanceDots apt={apt({ subway: 5 })} />);
    expect(screen.getByText("지하철역")).toBeInTheDocument();
  });

  it("축 정의에서 개수 필드를 지우면 라벨이 되돌아간다 (그림이 표를 흡수한 근거)", () => {
    // 개수를 그리는 건 이 그림뿐이다 — `countField` 가 비면 개수는 화면 어디에도 안 남는다.
    const withCount = DISTANCE_AXES.flatMap((a) => a.items).filter((i) => i.countField);
    expect(withCount.length, "개수 병기 대상이 사라졌다 — 서랍 계산도 같이 무너진다").toBe(11);
  });
});

describe("DistanceDots — 스크린리더", () => {
  it("한 문장으로 요약해 읽어준다", () => {
    render(<DistanceDots apt={apt()} />);
    const label = screen.getByRole("img").getAttribute("aria-label") || "";
    expect(label).toContain("가장 가까운 곳은");
    expect(label).not.toContain("점수"); // DetailModal 테스트 쿼리와 충돌 차단
  });

  it("개수도 함께 읽어준다 (눈으로 보는 것과 같은 말)", () => {
    render(<DistanceDots apt={apt({ conv: 12 })} />);
    const label = screen.getByRole("img").getAttribute("aria-label") || "";
    expect(label).toContain("편의점 12곳");
  });
});

describe("fmtDist", () => {
  it("1km 미만은 m, 넘으면 km", () => {
    expect(fmtDist(0)).toBe("0m");
    expect(fmtDist(999)).toBe("999m");
    expect(fmtDist(1000)).toBe("1km");
    expect(fmtDist(1200)).toBe("1.2km");
    expect(fmtDist(69072)).toBe("69.1km");
  });
});
