import { memo, type CSSProperties } from "react";
import { C, F } from "@/theme";
import { deviationAriaLabel, type Deviation } from "@/lib/deviation";
import { formatDeviationValue, type DeviationFieldSpec } from "@/constants/deviationFields";

/*
 * 차트 라이브러리 미사용 판단: recharts 147.5KB(gzip)=초기 예산의 116%, 최소 대안 d3-shape 5.7KB도
 * 곡선/호/레이더용인데 본 설계는 div·rect·line·circle 만 씀(레이더 의도적 배제).
 * 이 파일은 SVG 조차 쓰지 않는다 — div 5개다. 전례가 레포 안에 있다(PriceTable.tsx:104-135 가
 * position:absolute div 3겹으로 범위 막대 + 마커선을 만든다).
 */

/** 행 높이 — 결측이어도 이 높이를 유지해야 무한스크롤에서 스크롤 위치가 안 튄다 */
export const ROW_HEIGHT = 22;
/**
 * 트랙 최소 폭. 값 슬롯이 내용에 맞춰 늘어나므로 트랙이 그만큼 줄어든다.
 * 가장 좁은 1024 3열에서 실측한 값을 근거로 잡는다(아래 주석의 실측표 참조).
 * 이보다 좁아지면 1 백분위점이 1px 미만이 되어 좌/우 판독이 무너진다.
 */
const TRACK_MIN_WIDTH = 56;
/** 분포 양 끝(상·하위 10%)을 표시하는 캡 */
const SPARSE_CAP_PCT = 10;

const S = {
  row: { display: "flex", alignItems: "center", gap: 4, height: ROW_HEIGHT },
  label: {
    width: 40,
    flexShrink: 0,
    fontSize: F.sm,
    color: C.muted,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  },
  // 끝말도 폭을 고정하지 않는다. 문서는 20px 을 지정했지만 문서가 정한 단어("비싸다"·"가깝다",
  // 3글자 = 약 36px)가 그 안에 안 들어가 **잘리고 값 슬롯과 맞붙었다**(세션 487 실측).
  edge: { flexShrink: 0, fontSize: F.sm, color: C.muted, whiteSpace: "nowrap" as const },
  noWrapEllipsis: { whiteSpace: "nowrap" as const, overflow: "hidden" as const, textOverflow: "ellipsis" as const },
  track: {
    flex: 1,
    minWidth: TRACK_MIN_WIDTH,
    height: 8,
    background: C.track,
    borderRadius: 99,
    position: "relative" as const,
  },
  // 중앙 기준선 — 트랙 위아래로 2px 씩 돌출시켜 색 대비가 모자라도 형태로 읽히게 한다.
  center: {
    position: "absolute" as const,
    left: "50%",
    top: -2,
    width: 2,
    height: 12,
    marginLeft: -1,
    background: C.gridStrong,
    borderRadius: 1,
  },
  // 값 슬롯은 폭을 고정하지 않는다. 설계 문서는 76px 을 지정했지만 같은 문서가 정한 문구
  // ("41% 가까워요")가 14px 로는 그 안에 안 들어가 **두 줄로 넘치고 행 높이 고정이 깨졌다**
  // (세션 487 실측). 글자 크기를 줄이는 건 §5-4(값은 14px 이상, 주 구매층 40~60대) 위반이라
  // 폭을 내용에 맞추고 트랙이 나머지를 흡수하게 했다. nowrap 으로 줄바꿈을 원천 차단한다.
  value: {
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
    textAlign: "right" as const,
    fontSize: F.base,
    fontWeight: 700,
  },
};

/** 45° 회색 해칭 — "값이 있는 자리인데 아직 못 모았다"를 형태로 보여준다 */
const HATCH: CSSProperties = {
  backgroundImage: `repeating-linear-gradient(45deg, ${C.track} 0 3px, ${C.border} 3px 6px)`,
};

function toneColor(tone: Deviation["tone"]): string {
  return tone === "good" ? C.blue : tone === "bad" ? C.amber : C.muted;
}

/**
 * 편차 스트립 한 줄.
 *
 * **외울 규칙은 하나 — 막대가 오른쪽으로 길수록 유리하다.**
 * 그래서 트랙 양 끝에 한글 끝말(`싸다`/`비싸다`)을 박아 범례를 없앴고,
 * 오른쪽 값 슬롯은 숫자가 아니라 문장 조각(`12% 싸요`)이다.
 * `−12%` 는 "왜 마이너스인데 오른쪽이지?" 를 만들지만 `12% 싸요` 는 막대 방향과 어긋나지 않는다.
 */
export const DeviationRow = memo(function DeviationRow({
  spec,
  dev,
  value,
  regionLabel,
}: {
  spec: DeviationFieldSpec;
  dev: Deviation;
  value: unknown;
  regionLabel: string;
}) {
  const aria = deviationAriaLabel(spec, dev, regionLabel, formatDeviationValue(spec, value));

  const drawable = dev.state === "ok" && dev.fav != null;
  const fav = dev.fav ?? 50;
  // 트랙 절반이 백분위 50점에 대응하므로, 폭(%)은 곧 |fav − 50| 이다.
  const widthPct = Math.min(50, Math.abs(fav - 50));
  const good = fav > 50;
  const color = toneColor(dev.tone);
  const isSparseEnd = drawable && (fav <= SPARSE_CAP_PCT || fav >= 100 - SPARSE_CAP_PCT);

  // 비교 자체가 성립하지 않는 줄(표본 부족·그 지역이 다 같은 값)은 안내문이 길다
  // ("비교할 단지가 적어요" = 10자). 트랙·끝말을 그대로 두면 1024 3열에서 폭이 넘친다.
  // 어차피 그릴 막대가 없으므로 안내문이 트랙 자리를 쓰게 한다 — 행 높이 22 는 그대로다.
  if (dev.state === "sparse" || dev.state === "uniform") {
    return (
      <div style={S.row} role="img" aria-label={aria}>
        <span style={S.label}>{spec.label}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: F.sm, color: C.muted, ...S.noWrapEllipsis }} aria-hidden="true">
          {dev.text}
        </span>
      </div>
    );
  }

  return (
    <div style={S.row} role="img" aria-label={aria}>
      <span style={S.label}>{spec.label}</span>
      <span style={S.edge} aria-hidden="true">
        {spec.lowWord}
      </span>
      <div style={dev.state === "missing" ? { ...S.track, ...HATCH } : S.track} aria-hidden="true">
        <div style={S.center} />
        {drawable && (
          <div
            style={{
              position: "absolute",
              top: 0,
              height: 8,
              borderRadius: 99,
              background: color,
              width: `${widthPct}%`,
              ...(good ? { left: "50%" } : { right: "50%" }),
            }}
          >
            {/* 희소 캡 — 분포 양 끝(상·하위 10%)임을 막대 끝 진한 사각으로 알린다 */}
            {isSparseEnd && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  width: 3,
                  height: 8,
                  background: color,
                  filter: "brightness(0.82)",
                  ...(good ? { right: 0, borderRadius: "0 99px 99px 0" } : { left: 0, borderRadius: "99px 0 0 99px" }),
                }}
              />
            )}
          </div>
        )}
      </div>
      <span style={S.edge} aria-hidden="true">
        {spec.highWord}
      </span>
      <span style={{ ...S.value, color }} aria-hidden="true">
        {dev.text}
      </span>
    </div>
  );
});
