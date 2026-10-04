import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistanceDots, fmtDist, parseKmText } from "./DistanceDots";
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
    icDist: 2.4, // km (세션591 — 20km 줄)
    ktxDist: 6, // km
    ...over,
  } as unknown as Apt;
}

describe("DistanceDots — 축 구성", () => {
  it("자릿수가 다른 거리를 축 5개로 나눈다 (세션591: IC·KTX 20km 줄 · 개발 사업지 5km 줄)", () => {
    expect(DISTANCE_AXES).toHaveLength(5);
    expect(DISTANCE_AXES.map((a) => a.cap)).toEqual([500, 1000, 10000, 20000, 5000]);
  });

  it("IC·KTX 는 '차로 10km' 줄이 아니라 따로 0~20km 줄에 있다 (사장님 결정 L1)", () => {
    const axisOf = (f: string) => DISTANCE_AXES.find((a) => a.items.some((i) => i.field === f));
    expect(axisOf("icDist")?.cap).toBe(20000);
    expect(axisOf("ktxDist")?.cap).toBe(20000);
    expect(axisOf("subwayDist")?.cap).toBe(10000);
    expect(axisOf("icDist")?.items.every((i) => i.unit === "km")).toBe(true);
  });

  it("초·중·고 거리는 '걸어서 갈 만한 거리'(0~1km) 줄에 있다 (목업)", () => {
    const ax = DISTANCE_AXES.find((a) => a.cap === 1000);
    expect(ax?.items.filter((i) => i.schoolType).map((i) => i.schoolType)).toEqual(["초", "중", "고"]);
  });

  it("옛 서랍 4필드가 '개발 사업지' 줄에 있다 (교통개발 이름 + 개발지 거리 · 도시·산업 개발 글자)", () => {
    const ax = DISTANCE_AXES.find((a) => a.cap === 5000);
    const f = ax?.items.flatMap((i) => [i.field, i.nameField].filter(Boolean));
    expect(f?.sort()).toEqual(["cityDev", "devDist", "industryDev", "transitDev"]);
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

  // 세션591: 옛 "ktxDist·icDist 는 넣지 않는다" 두 단언은 뒤집혔다 — 사유가 **단위**뿐이었고,
  //   이제 그 둘은 km 표시(unit:"km")를 달고 자기 전용 20km 줄에 오른다(위 "축 구성" 묶음이 지킨다).
  it("km 필드는 전부 unit:'km' 표시가 붙어 있다 (m 로 읽혀 'IC 8m' 가 되지 않게)", () => {
    const KM_FIELDS = ["icDist", "ktxDist", "devDist"];
    for (const ax of DISTANCE_AXES)
      for (const it of ax.items) if (KM_FIELDS.includes(it.field)) expect(it.unit, it.field).toBe("km");
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

  it("센티널(지하철 9999)은 점이 아니라 '10km 안에 없음' — 수집 반경을 찾아봤는데 없던 것 (세션591 L2)", () => {
    const { container } = render(<DistanceDots apt={apt({ subwayDist: 9999 })} />);
    expect(screen.getByText("지하철역")).toBeInTheDocument();
    expect(screen.getByText("10km 안에 없음")).toBeInTheDocument();
    expect(screen.queryByText("미수집")).toBeNull();
    expect(screen.queryByText("10km")).toBeNull(); // 9999m 를 거리처럼 적지 않는다
    expect(container.querySelector('[data-row="subwayDist"] [data-state="out-of-range"]')).not.toBeNull();
  });

  it("IC·KTX 99 는 '20km 안에 없음' (사장님 결정 L2) · null 은 지금처럼 미수집", () => {
    render(<DistanceDots apt={apt({ icDist: 99, ktxDist: null })} />);
    expect(screen.getByText("20km 안에 없음")).toBeInTheDocument();
    expect(screen.getAllByText("미수집")).toHaveLength(1); // KTX null 하나
  });

  // 보완 F8 — 교통 자료 행 자체가 없는 단지(정적 JSON 1곳 = ah-2026910248)는 VIEW 가 지하철만 9999 로 채운다.
  //   찾아본 적이 없으니 "10km 안에 없음"은 거짓 → 같은 수집기가 쓰는 IC·KTX 가 둘 다 null 이면 미수집.
  it("지하철 9999 라도 IC·KTX 가 둘 다 null(교통 자료 행 없음)이면 '미수집' — '10km 안에 없음' 아님", () => {
    const { container } = render(<DistanceDots apt={apt({ subwayDist: 9999, icDist: null, ktxDist: null })} />);
    expect(screen.queryByText("10km 안에 없음")).toBeNull();
    expect(container.querySelector('[data-row="subwayDist"]')?.textContent).toContain("미수집");
  });

  it("IC·KTX 중 하나라도 값이 있으면(교통 자료 행 있음) 지하철 9999 는 '10km 안에 없음' 그대로 (양성 대조)", () => {
    render(<DistanceDots apt={apt({ subwayDist: 9999, icDist: null, ktxDist: 14 })} />);
    expect(screen.getByText("10km 안에 없음")).toBeInTheDocument();
  });

  it("음수 거리는 점을 안 찍고 미수집 (보완 F9)", () => {
    const { container } = render(<DistanceDots apt={apt({ convDist: -5, icDist: -1 })} />);
    expect(container.querySelector('[data-row="convDist"]')?.textContent).toContain("미수집");
    expect(container.querySelector('[data-row="icDist"]')?.textContent).toContain("미수집");
    expect(container.querySelector('[data-row="convDist"] div[style*="border-radius: 50%"]')).toBeNull();
  });

  it("개발 거리가 5km 축을 넘으면 끝에 테두리만 찍고 실제 값을 적는다 (축 밖 그림, 보완 F9)", () => {
    const { container } = render(<DistanceDots apt={apt({ industryDev: "먼산단 7.5km" })} />);
    const row = container.querySelector('[data-row="industryDev"]');
    expect(row?.textContent).toContain("7.5km");
    const dot = row?.querySelector<HTMLElement>('div[style*="border-radius: 50%"]');
    expect(dot?.style.left).toBe("100%");
    expect(dot?.style.background).toBe("rgb(255, 255, 255)"); // 축 밖 = 흰 속 + 주황 테두리
  });

  it("IC·KTX km 값은 m 로 바꿔 20km 줄에 점으로 — 0.2km → 200m, 8.2km 는 축 안", () => {
    const { container } = render(<DistanceDots apt={apt({ icDist: 0.2, ktxDist: 8.2 })} />);
    expect(container.querySelector('[data-row="icDist"]')?.textContent).toContain("200m");
    expect(container.querySelector('[data-row="ktxDist"]')?.textContent).toContain("8.2km");
    const dot = container.querySelector('[data-row="ktxDist"] div[style*="left: 41%"]');
    expect(dot, "8.2km 는 20km 줄의 41% 자리").not.toBeNull();
  });

  it("초·중·고 가장 가까운 학교 거리를 1km 줄에 — 학교가 아닌 이름은 빼고, 없는 종류는 줄을 안 그린다", () => {
    render(
      <DistanceDots
        apt={apt({
          nearbySchools: [
            { name: "가나초등학교", type: "초", distance: 335 },
            { name: "다라초등학교", type: "초", distance: 120 },
            { name: "마바중학교", type: "중", distance: 405 },
            { name: "사아학원", type: "고", distance: 50 },
          ],
        })}
      />
    );
    expect(screen.getByText("초등학교")).toBeInTheDocument();
    expect(screen.getByText("120m")).toBeInTheDocument(); // 가까운 쪽
    expect(screen.getByText("405m")).toBeInTheDocument();
    expect(screen.queryByText("고등학교")).toBeNull(); // 학원은 학교가 아니다 → 고등학교 줄 없음
    expect(screen.queryByText("50m")).toBeNull();
  });

  it("개발 사업지 — 교통개발 이름 + 개발지 km · 도시/산업 개발 글자 속 km 를 읽는다", () => {
    const { container } = render(
      <DistanceDots
        apt={apt({
          transitDev: "인덕원동탄선 인덕원역 착공",
          devDist: 1.6,
          cityDev: "의왕내손 0.7km",
          industryDev: "안양평촌스마트스퀘어 1.9km",
        })}
      />
    );
    const row = (k: string) => container.querySelector(`[data-row="${k}"]`)?.textContent ?? "";
    expect(screen.getByText("개발 사업지까지")).toBeInTheDocument();
    expect(row("devDist")).toContain("교통 개발");
    expect(row("devDist")).toContain("인덕원동탄선 인덕원역 착공");
    expect(row("devDist")).toContain("1.6km");
    expect(row("cityDev")).toContain("의왕내손");
    expect(row("cityDev")).toContain("700m");
    expect(row("industryDev")).toContain("안양평촌스마트스퀘어");
    expect(row("industryDev")).toContain("1.9km");
  });

  it("개발 사업지 — km 를 못 읽는 글자는 이름만 두고 거리는 미수집, 셋 다 없으면 줄 제목도 없다", () => {
    const { unmount } = render(<DistanceDots apt={apt({ cityDev: "청주분평 도시개발" })} />);
    expect(screen.getByText("청주분평 도시개발")).toBeInTheDocument();
    expect(screen.getByText("미수집")).toBeInTheDocument();
    expect(screen.queryByText("교통 개발")).toBeNull(); // 이름·거리 다 없는 줄은 안 그린다
    unmount();
    render(<DistanceDots apt={apt()} />);
    expect(screen.queryByText("개발 사업지까지")).toBeNull();
  });

  it("좌표 공유 단지는 점을 하나도 안 그리고 '위치 확인 중' 사실 한 줄 (세션568-3 · 세션591 L7)", () => {
    const { container } = render(
      <DistanceDots apt={apt({ coordShared: true, icDist: 1.2, cityDev: "수원조원 0.6km" })} />
    );
    expect(container.querySelector('[data-state="coord-unknown"]')?.textContent).toBe("위치 확인 중");
    expect(screen.queryByText("100m")).toBeNull();
    expect(screen.queryByText("1.2km")).toBeNull();
    expect(screen.queryByText("600m")).toBeNull();
    expect(container.textContent).not.toMatch(/정확하지|참고로|오차/); // 경고문 금지
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

describe("parseKmText — 글자 끝 'N km' 읽기", () => {
  it("끝의 km 를 거리(m)로, 앞을 이름으로", () => {
    expect(parseKmText("고양덕은 도시개발사업 0.3km")).toEqual({ name: "고양덕은 도시개발사업", m: 300 });
    expect(parseKmText("마곡 2.1km")).toEqual({ name: "마곡", m: 2100 });
    expect(parseKmText("마곡 2 km")).toEqual({ name: "마곡", m: 2000 });
  });

  it("km 가 없거나 비면 — 이름만 / 둘 다 null", () => {
    expect(parseKmText("청주분평 도시개발")).toEqual({ name: "청주분평 도시개발", m: null });
    expect(parseKmText("")).toEqual({ name: null, m: null });
    expect(parseKmText(null)).toEqual({ name: null, m: null });
    expect(parseKmText(12)).toEqual({ name: null, m: null });
  });

  it("글자 가운데 숫자는 거리로 안 읽는다 (번지 '1013-3' 등)", () => {
    expect(parseKmText("강서구 화곡동 1013-3번지 일원 역세권 청년주택 1.3km").m).toBe(1300);
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
