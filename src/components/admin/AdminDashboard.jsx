import { memo, useState } from "react";
import { C } from "@/theme";
import { AdminHelpGuide } from "./AdminHelpGuide";
import WeightEditor from "./WeightEditor";

const STATUS_TABS = [
  { key: "pending", label: "대기중", color: "#92400E", bg: "#FFFBEB" },
  { key: "approved", label: "승인됨", color: C.green, bg: C.greenLight },
  { key: "rejected", label: "거부됨", color: C.red, bg: C.redLight },
  { key: "suspended", label: "정지됨", color: "#DC2626", bg: "#FEE2E2" },
  { key: "all", label: "전체", color: C.text, bg: C.slate100 },
];

const SPECIALTY_BADGE = {
  "부동산 중개": { color: "#1D4ED8", bg: "#DBEAFE" },
  "분양 컨설팅": { color: "#7C3AED", bg: "#EDE9FE" },
  "감정평가": { color: "#059669", bg: "#D1FAE5" },
  "건축/설계": { color: "#EA580C", bg: "#FFF7ED" },
  "기타": { color: C.muted, bg: C.slate100 },
};

function StatsSection({ stats }) {
  const { counts, userTypes, specialtyDist, recentSignups } = stats;
  const maxSignup = Math.max(...recentSignups.map(d => d.count), 1);
  const userTotal = (userTypes.kakao || 0) + (userTypes.expert || 0);
  const kakaoRatio = userTotal > 0 ? Math.round((userTypes.kakao / userTotal) * 100) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 10 }}>사용자 통계</div>

      {/* 상태별 카운트 카드 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {STATUS_TABS.filter(t => t.key !== "all").map(t => (
          <div key={t.key} style={{
            flex: "1 1 70px", minWidth: 70, background: t.bg, borderRadius: 8,
            padding: "10px 8px", textAlign: "center", border: `1px solid ${t.color}20`,
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: t.color }}>{counts[t.key] ?? 0}</div>
            <div style={{ fontSize: 10, color: t.color, fontWeight: 600, marginTop: 2 }}>{t.label}</div>
          </div>
        ))}
        <div style={{
          flex: "1 1 70px", minWidth: 70, background: C.blueLight, borderRadius: 8,
          padding: "10px 8px", textAlign: "center", border: `1px solid ${C.blue}20`,
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.blue }}>{counts.total ?? 0}</div>
          <div style={{ fontSize: 10, color: C.blue, fontWeight: 600, marginTop: 2 }}>전체</div>
        </div>
      </div>

      {/* 사용자 유형 비율 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>사용자 유형</div>
        <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", background: C.slate100 }}>
          {kakaoRatio > 0 && (
            <div style={{ width: `${kakaoRatio}%`, background: "#FEE500", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#191919", minWidth: kakaoRatio > 10 ? "auto" : 0 }}>
              {kakaoRatio > 15 ? `카카오 ${userTypes.kakao}` : ""}
            </div>
          )}
          {kakaoRatio < 100 && (
            <div style={{ flex: 1, background: C.indigo, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: C.white, minWidth: (100 - kakaoRatio) > 10 ? "auto" : 0 }}>
              {(100 - kakaoRatio) > 15 ? `전문가 ${userTypes.expert}` : ""}
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 10, color: C.muted }}>
          <span>카카오 {userTypes.kakao}명 ({kakaoRatio}%)</span>
          <span>전문가 {userTypes.expert}명 ({100 - kakaoRatio}%)</span>
        </div>
      </div>

      {/* 전문 분야 분포 */}
      {Object.keys(specialtyDist).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>전문 분야 분포</div>
          {Object.entries(specialtyDist).sort((a, b) => b[1] - a[1]).map(([spec, cnt]) => {
            const badge = SPECIALTY_BADGE[spec] || SPECIALTY_BADGE["기타"];
            const maxCnt = Math.max(...Object.values(specialtyDist), 1);
            return (
              <div key={spec} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: badge.color, minWidth: 80 }}>{spec}</span>
                <div style={{ flex: 1, height: 14, background: C.slate100, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(cnt / maxCnt) * 100}%`, height: "100%", background: badge.bg, borderRadius: 4, transition: "width .3s" }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.text, minWidth: 24, textAlign: "right" }}>{cnt}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 최근 14일 가입 추이 */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>최근 14일 가입 추이</div>
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
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 9, color: C.muted }}>
          <span>{recentSignups[0]?.date.slice(5)}</span>
          <span>{recentSignups[recentSignups.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    </div>
  );
}

export const AdminDashboard = memo(function AdminDashboard({ admin, onLogout, onSwitchToExpert, profile, setProfile, customWeights, saveCustomWeights, scored }) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div style={{ padding: "0 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>관리자 대시보드</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setHelpOpen(v => !v)} style={{
            background: helpOpen ? C.purple : C.purpleLight, color: helpOpen ? C.white : C.purple,
            border: `1px solid ${C.purple}`, borderRadius: 6,
            padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer"
          }}>도움말</button>
          {onSwitchToExpert && (
            <button onClick={onSwitchToExpert} style={{
              background: C.indigoLight, color: C.indigo, border: `1px solid ${C.indigo}`, borderRadius: 6,
              padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer"
            }}>전문가 보기</button>
          )}
          <button onClick={() => admin.handleAdminLogout(onLogout)} style={{
            background: C.redLight, color: C.red, border: `1px solid #FECACA`, borderRadius: 6,
            padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer"
          }}>로그아웃</button>
        </div>
      </div>

      <AdminHelpGuide open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Weight Editor Section */}
      <WeightEditor profile={profile} setProfile={setProfile} customWeights={customWeights} saveCustomWeights={saveCustomWeights} scored={scored} />

      {/* Stats Section */}
      {admin.stats && <StatsSection stats={admin.stats} />}
      {admin.statsLoading && (
        <div style={{ textAlign: "center", padding: 16, color: C.muted, fontSize: 12, marginBottom: 12 }}>통계 로딩 중...</div>
      )}

      {/* Expert Applications Section */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>전문가 신청 관리</div>
        <div style={{ fontSize: 11, color: C.muted }}>전체 {admin.totalUsers}건</div>
      </div>

      {/* 검색 */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          type="text" placeholder="이름, 이메일, 소속 검색..." value={admin.searchQuery}
          onChange={e => admin.setSearchQuery(e.target.value)}
          style={{
            width: "100%", padding: "8px 32px 8px 12px", fontSize: 13, borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.white, color: C.text,
            outline: "none", boxSizing: "border-box",
          }}
        />
        {admin.searchQuery && (
          <button type="button" onClick={() => admin.setSearchQuery("")}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, padding: 0,
            }}
          >✕</button>
        )}
      </div>

      {/* Status Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {STATUS_TABS.map(t => {
          const active = admin.selectedStatus === t.key;
          return (
            <button key={t.key} onClick={() => admin.setSelectedStatus(t.key)} style={{
              flex: 1, padding: "8px 4px", fontSize: 12, fontWeight: active ? 700 : 500,
              background: active ? t.bg : C.white, color: active ? t.color : C.muted,
              border: active ? `1.5px solid ${t.color}` : `1px solid ${C.border}`,
              borderRadius: 6, cursor: "pointer", transition: "all .15s"
            }}>{t.label}</button>
          );
        })}
      </div>

      {admin.adminLoading && (
        <div style={{ textAlign: "center", padding: 20, color: C.muted, fontSize: 12 }}>로딩 중...</div>
      )}

      {!admin.adminLoading && admin.users.length === 0 && (
        <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {admin.searchQuery ? "검색 결과가 없습니다" : admin.selectedStatus === "pending" ? "대기중인 신청이 없습니다" : admin.selectedStatus === "suspended" ? "정지된 사용자가 없습니다" : "해당 상태의 사용자가 없습니다"}
          </div>
        </div>
      )}

      {/* 일괄 처리 바 — pending 탭일 때만 */}
      {admin.selectedStatus === "pending" && admin.users.length > 0 && !admin.adminLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.sub }}>
            <input type="checkbox"
              checked={admin.users.length > 0 && admin.users.every(u => admin.selectedEmails.has(u.email))}
              onChange={() => admin.selectAllEmails(admin.users.map(u => u.email))}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />전체 선택
          </label>
          {admin.selectedEmails.size > 0 && (
            <>
              <span style={{ fontSize: 11, color: C.muted }}>{admin.selectedEmails.size}건 선택</span>
              <button
                disabled={admin.batchLoading}
                onClick={() => admin.handleBatchReview("approve")}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 700, borderRadius: 6,
                  background: C.green, color: C.white, border: "none",
                  cursor: admin.batchLoading ? "default" : "pointer",
                  opacity: admin.batchLoading ? 0.6 : 1, minHeight: 32,
                }}>일괄 승인</button>
              <button
                disabled={admin.batchLoading}
                onClick={() => admin.handleBatchReview("reject")}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 700, borderRadius: 6,
                  background: C.white, color: C.red, border: `1.5px solid ${C.red}`,
                  cursor: admin.batchLoading ? "default" : "pointer",
                  opacity: admin.batchLoading ? 0.6 : 1, minHeight: 32,
                }}>일괄 거부</button>
            </>
          )}
        </div>
      )}

      {/* User Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {admin.users.map(user => {
          const badge = SPECIALTY_BADGE[user.specialty] || SPECIALTY_BADGE["기타"];
          const STATUS_LABELS = { approved: "승인됨", rejected: "거부됨", suspended: "정지됨", pending: "대기중" };
          const statusLabel = STATUS_LABELS[user.status] || "대기중";
          const statusStyle = STATUS_TABS.find(t => t.key === user.status) || STATUS_TABS[0];

          return (
            <div key={user.email} style={{
              background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 16,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              {/* Header row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  {admin.selectedStatus === "pending" && (
                    <input type="checkbox" checked={admin.selectedEmails.has(user.email)}
                      onChange={() => admin.toggleSelectEmail(user.email)}
                      style={{ width: 16, height: 16, marginTop: 2, cursor: "pointer" }} />
                  )}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{user.email}</div>
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                  color: statusStyle.color, background: statusStyle.bg
                }}>{statusLabel}</span>
              </div>

              {/* Info grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 10 }}>
                {user.affiliation && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>소속</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.affiliation}</div>
                  </div>
                )}
                {user.phone && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>연락처</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.phone}</div>
                  </div>
                )}
                {user.specialty && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>전문 분야</div>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 3, color: badge.color, background: badge.bg }}>{user.specialty}</span>
                  </div>
                )}
                {user.license && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>자격증</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.license}</div>
                  </div>
                )}
                {user.experience != null && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>경력</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.experience}년</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>가입일</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{new Date(user.createdAt).toLocaleDateString("ko-KR")}</div>
                </div>
              </div>

              {/* Bio */}
              {user.bio && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>자기소개</div>
                  <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, background: C.slate100, borderRadius: 6, padding: "8px 10px" }}>{user.bio}</div>
                </div>
              )}

              {/* Review note */}
              {user.reviewNote && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>관리자 메모</div>
                  <div style={{ fontSize: 11, color: C.sub, fontStyle: "italic" }}>{user.reviewNote}</div>
                </div>
              )}

              {/* Action buttons for pending users */}
              {user.status === "pending" && (
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
                    onClick={() => admin.handleReview(user.email, "approve")}
                    style={{
                      flex: 1, padding: "10px", fontSize: 13, fontWeight: 700,
                      background: C.green, color: C.white, border: "none", borderRadius: 6,
                      cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
                      opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, minHeight: 40
                    }}>승인</button>
                  <button
                    disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
                    onClick={() => admin.handleReview(user.email, "reject")}
                    style={{
                      flex: 1, padding: "10px", fontSize: 13, fontWeight: 700,
                      background: C.white, color: C.red, border: `1.5px solid ${C.red}`, borderRadius: 6,
                      cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
                      opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, minHeight: 40
                    }}>거부</button>
                </div>
              )}

              {/* 강제 로그아웃 — approved 사용자 대상 */}
              {user.status === "approved" && (
                <button
                  disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
                  onClick={() => admin.handleReview(user.email, "force-logout")}
                  style={{
                    width: "100%", padding: "8px", fontSize: 12, fontWeight: 700,
                    background: C.white, color: "#DC2626", border: "1.5px solid #DC2626", borderRadius: 6,
                    cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
                    opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, marginTop: 4, minHeight: 40
                  }}>강제 로그아웃</button>
              )}

              {/* 재승인 — rejected 또는 suspended 사용자 대상 */}
              {(user.status === "rejected" || user.status === "suspended") && (
                <button
                  disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
                  onClick={() => admin.handleReview(user.email, "approve")}
                  style={{
                    width: "100%", padding: "8px", fontSize: 12, fontWeight: 700,
                    background: C.white, color: C.green, border: `1.5px solid ${C.green}`, borderRadius: 6,
                    cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
                    opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, marginTop: 4, minHeight: 40
                  }}>재승인</button>
              )}
            </div>
          );
        })}
      </div>

      {/* 페이지네이션 */}
      {admin.totalUsers > admin.PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          <button type="button" disabled={admin.page === 0} onClick={() => admin.handlePageChange(admin.page - 1)}
            style={{
              padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${C.border}`, background: admin.page === 0 ? C.slate100 : C.white,
              color: admin.page === 0 ? C.muted : C.text, cursor: admin.page === 0 ? "default" : "pointer",
            }}>이전</button>
          <span style={{ fontSize: 12, color: C.muted }}>
            {admin.page * admin.PAGE_SIZE + 1}~{Math.min((admin.page + 1) * admin.PAGE_SIZE, admin.totalUsers)}건 / 전체 {admin.totalUsers}건
          </span>
          <button type="button" disabled={(admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers}
            onClick={() => admin.handlePageChange(admin.page + 1)}
            style={{
              padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? C.slate100 : C.white,
              color: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? C.muted : C.text,
              cursor: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? "default" : "pointer",
            }}>다음</button>
        </div>
      )}
    </div>
  );
});
