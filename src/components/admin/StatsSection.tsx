import { C, F } from "@/theme";
import { STATUS_TABS, SPECIALTY_BADGE } from "./constants";
import type { StatsSectionProps } from "@/types/admin";

export function StatsSection({ stats }: StatsSectionProps) {
  const { counts, userTypes, marketing, specialtyDist, recentSignups } = stats;
  const maxSignup = Math.max(...recentSignups.map(d => d.count), 1);
  const userTotal = (userTypes.kakao || 0) + (userTypes.expert || 0);
  const kakaoRatio = userTotal > 0 ? Math.round((userTypes.kakao / userTotal) * 100) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text, marginBottom: 10 }}>사용자 통계</div>

      {/* 상태별 카운트 카드 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {STATUS_TABS.filter(t => t.key !== "all").map(t => (
          <div key={t.key} style={{
            flex: "1 1 70px", minWidth: 70, background: t.bg, borderRadius: 8,
            padding: "10px 8px", textAlign: "center", border: `1px solid ${t.color}20`,
          }}>
            <div style={{ fontSize: F.xxl, fontWeight: 800, color: t.color }}>{counts[t.key] ?? 0}</div>
            <div style={{ fontSize: F.micro, color: t.color, fontWeight: 600, marginTop: 2 }}>{t.label}</div>
          </div>
        ))}
        <div style={{
          flex: "1 1 70px", minWidth: 70, background: C.blueLight, borderRadius: 8,
          padding: "10px 8px", textAlign: "center", border: `1px solid ${C.blue}20`,
        }}>
          <div style={{ fontSize: F.xxl, fontWeight: 800, color: C.blue }}>{counts.total ?? 0}</div>
          <div style={{ fontSize: F.micro, color: C.blue, fontWeight: 600, marginTop: 2 }}>전체</div>
        </div>
      </div>

      {/* 사용자 유형 비율 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: F.xs, fontWeight: 700, color: C.sub, marginBottom: 4 }}>사용자 유형</div>
        <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", background: C.slate100 }}>
          {kakaoRatio > 0 && (
            <div style={{ width: `${kakaoRatio}%`, background: "#FEE500", display: "flex", alignItems: "center", justifyContent: "center", fontSize: F.micro, fontWeight: 700, color: "#191919", minWidth: kakaoRatio > 10 ? "auto" : 0 }}>
              {kakaoRatio > 15 ? `카카오 ${userTypes.kakao}` : ""}
            </div>
          )}
          {kakaoRatio < 100 && (
            <div style={{ flex: 1, background: C.indigo, display: "flex", alignItems: "center", justifyContent: "center", fontSize: F.micro, fontWeight: 700, color: C.white, minWidth: (100 - kakaoRatio) > 10 ? "auto" : 0 }}>
              {(100 - kakaoRatio) > 15 ? `이메일 가입 ${userTypes.expert}` : ""}
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: F.micro, color: C.muted }}>
          <span>카카오 {userTypes.kakao}명 ({kakaoRatio}%)</span>
          {/* API 필드명 userTypes.expert 는 보존 (PR-3 범위 밖) — 라벨만 정정 (세션 405) */}
          <span>이메일 가입 {userTypes.expert}명 ({100 - kakaoRatio}%)</span>
        </div>
      </div>

      {/* 마케팅 동의 / 연락처 보유 (세션 427) */}
      {marketing && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: F.xs, fontWeight: 700, color: C.sub, marginBottom: 4 }}>마케팅·연락처</div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "10px 8px", textAlign: "center", border: `1px solid ${C.green}20` }}>
              <div style={{ fontSize: F.xl, fontWeight: 800, color: C.green }}>{marketing.consent}</div>
              <div style={{ fontSize: F.micro, color: C.green, fontWeight: 600, marginTop: 2 }}>마케팅 동의</div>
            </div>
            <div style={{ flex: 1, background: C.purpleLight, borderRadius: 8, padding: "10px 8px", textAlign: "center", border: `1px solid ${C.purple}20` }}>
              <div style={{ fontSize: F.xl, fontWeight: 800, color: C.purple }}>{marketing.withPhone}</div>
              <div style={{ fontSize: F.micro, color: C.purple, fontWeight: 600, marginTop: 2 }}>전화번호 보유</div>
            </div>
          </div>
        </div>
      )}

      {/* 전문 분야 분포 */}
      {Object.keys(specialtyDist).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: F.xs, fontWeight: 700, color: C.sub, marginBottom: 4 }}>전문 분야 분포</div>
          {Object.entries(specialtyDist).sort((a, b) => b[1] - a[1]).map(([spec, cnt]) => {
            const badge = SPECIALTY_BADGE[spec] || SPECIALTY_BADGE["기타"];
            const maxCnt = Math.max(...Object.values(specialtyDist), 1);
            return (
              <div key={spec} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: F.xs, fontWeight: 600, color: badge.color, minWidth: 80 }}>{spec}</span>
                <div style={{ flex: 1, height: 14, background: C.slate100, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(cnt / maxCnt) * 100}%`, height: "100%", background: badge.bg, borderRadius: 4, transition: "width .3s" }} />
                </div>
                <span style={{ fontSize: F.xs, fontWeight: 700, color: C.text, minWidth: 24, textAlign: "right" }}>{cnt}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 최근 14일 가입 추이 */}
      <div>
        <div style={{ fontSize: F.xs, fontWeight: 700, color: C.sub, marginBottom: 4 }}>최근 14일 가입 추이</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
          {recentSignups.map(d => (
            <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{
                width: "100%", maxWidth: 24, borderRadius: 3,
                height: d.count > 0 ? Math.max(8, (d.count / maxSignup) * 48) : 2,
                background: d.count > 0 ? C.blue : C.slate100,
                transition: "height .3s",
              }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: F.micro, color: C.muted }}>
          <span>{recentSignups[0]?.date.slice(5)}</span>
          <span>{recentSignups[recentSignups.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    </div>
  );
}
