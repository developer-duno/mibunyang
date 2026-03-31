import { memo, useState, useCallback, useMemo } from "react";
import { C, catCol, catBg } from "@/theme";
import { PROFILES } from "@/constants/profiles";
import { AdminHelpGuide } from "./AdminHelpGuide";

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

const CAT_LABELS = { location: "입지", product: "상품", price: "가격", risk: "안전", benefit: "혜택", future: "미래" };
const CAT_KEYS = ["location", "product", "price", "risk", "benefit", "future"];

function WeightEditor({ profile, setProfile, customWeights, saveCustomWeights, scored }) {
  const [editingProfile, setEditingProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [previewAptIdx, setPreviewAptIdx] = useState(0);

  const startEdit = useCallback((pKey) => {
    const current = customWeights[pKey] ?? PROFILES[pKey].w;
    setDraft({ ...current });
    setEditingProfile(pKey);
  }, [customWeights]);

  const cancelEdit = useCallback(() => { setEditingProfile(null); setDraft({}); }, []);

  const handleChange = useCallback((catKey, val) => {
    const n = val === "" ? 0 : parseInt(val, 10);
    if (isNaN(n) || n < 0 || n > 100) return;
    setDraft(prev => ({ ...prev, [catKey]: n }));
  }, []);

  const sum = CAT_KEYS.reduce((s, k) => s + (draft[k] ?? 0), 0);

  const handleSave = useCallback(() => {
    if (sum !== 100) return;
    const next = { ...customWeights, [editingProfile]: { ...draft } };
    saveCustomWeights(next);
    setEditingProfile(null);
    setDraft({});
  }, [sum, editingProfile, draft, customWeights, saveCustomWeights]);

  const handleReset = useCallback((pKey) => {
    const next = { ...customWeights };
    delete next[pKey];
    saveCustomWeights(next);
    if (editingProfile === pKey) { setEditingProfile(null); setDraft({}); }
  }, [customWeights, saveCustomWeights, editingProfile]);

  // Top 5 apartments for score breakdown preview
  const topApts = useMemo(() => (scored || []).slice(0, 5), [scored]);
  const previewItem = topApts[previewAptIdx] || topApts[0];

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 12 }}>가중치 관리</div>

      {/* Profile tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {Object.entries(PROFILES).map(([pKey, p]) => {
          const active = profile === pKey;
          const isCustom = !!customWeights[pKey];
          return (
            <button key={pKey} onClick={() => setProfile(pKey)} style={{
              padding: "6px 14px", fontSize: 12, fontWeight: active ? 700 : 500,
              background: active ? C.indigoLight : C.white, color: active ? C.indigo : C.muted,
              border: active ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
              borderRadius: 6, cursor: "pointer", transition: "all .15s", position: "relative"
            }}>
              {p.name}
              {isCustom && <span style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: "50%", background: C.amber }} />}
            </button>
          );
        })}
      </div>

      {/* Weight table for all profiles */}
      <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "80px repeat(6, 1fr) 120px", gap: 0, background: C.slate100, padding: "8px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>프로필</div>
          {CAT_KEYS.map(k => (
            <div key={k} style={{ fontSize: 11, fontWeight: 700, color: catCol[k], textAlign: "center" }}>{CAT_LABELS[k]}</div>
          ))}
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "center" }}>작업</div>
        </div>

        {/* Rows */}
        {Object.entries(PROFILES).map(([pKey, p]) => {
          const isEditing = editingProfile === pKey;
          const w = customWeights[pKey] ?? p.w;
          const isCustom = !!customWeights[pKey];
          const isActive = profile === pKey;

          return (
            <div key={pKey} style={{
              display: "grid", gridTemplateColumns: "80px repeat(6, 1fr) 120px", gap: 0,
              padding: "10px 12px", borderTop: `1px solid ${C.border}`,
              background: isActive ? C.indigoLight + "40" : C.white
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, display: "flex", alignItems: "center" }}>
                {p.name}
                {isCustom && <span style={{ fontSize: 9, color: C.amber, marginLeft: 4 }}>수정됨</span>}
              </div>

              {CAT_KEYS.map(k => (
                <div key={k} style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isEditing ? (
                    <input
                      type="number"
                      min={0} max={100}
                      value={draft[k] ?? 0}
                      onChange={e => handleChange(k, e.target.value)}
                      style={{
                        width: 44, textAlign: "center", fontSize: 12, fontWeight: 700,
                        padding: "4px 2px", border: `1.5px solid ${catCol[k]}`, borderRadius: 4,
                        color: catCol[k], background: catBg[k], outline: "none"
                      }}
                    />
                  ) : (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: catCol[k],
                      background: catBg[k], padding: "3px 8px", borderRadius: 4, minWidth: 32
                    }}>{w[k]}</span>
                  )}
                </div>
              ))}

              <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "center" }}>
                {isEditing ? (
                  <>
                    <button onClick={handleSave} disabled={sum !== 100} style={{
                      fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 4, cursor: sum === 100 ? "pointer" : "default",
                      background: sum === 100 ? C.green : C.slate100, color: sum === 100 ? C.white : C.muted,
                      border: "none", opacity: sum === 100 ? 1 : 0.5
                    }}>저장</button>
                    <button onClick={cancelEdit} style={{
                      fontSize: 11, fontWeight: 600, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                      background: C.white, color: C.muted, border: `1px solid ${C.border}`
                    }}>취소</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(pKey)} style={{
                      fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                      background: C.indigoLight, color: C.indigo, border: `1px solid ${C.indigo}`
                    }}>편집</button>
                    {isCustom && (
                      <button onClick={() => handleReset(pKey)} style={{
                        fontSize: 11, fontWeight: 600, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                        background: C.white, color: C.muted, border: `1px solid ${C.border}`
                      }}>초기화</button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sum validation message */}
      {editingProfile && (
        <div style={{
          marginTop: 8, fontSize: 11, fontWeight: 600, padding: "6px 12px", borderRadius: 6,
          background: sum === 100 ? C.greenLight : C.redLight,
          color: sum === 100 ? C.green : C.red
        }}>
          합계: {sum}% {sum === 100 ? "— 저장 가능" : `— 100%가 되어야 합니다 (${sum > 100 ? `${sum - 100}% 초과` : `${100 - sum}% 부족`})`}
        </div>
      )}

      {/* Score Breakdown Preview */}
      {previewItem && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>가중치 산출 내역 미리보기</div>
            <div style={{ display: "flex", gap: 4 }}>
              {topApts.map((item, i) => (
                <button key={item.apt.id} onClick={() => setPreviewAptIdx(i)} style={{
                  padding: "3px 8px", fontSize: 10, fontWeight: previewAptIdx === i ? 700 : 500, borderRadius: 4, cursor: "pointer",
                  background: previewAptIdx === i ? C.indigoLight : C.white,
                  color: previewAptIdx === i ? C.indigo : C.muted,
                  border: previewAptIdx === i ? `1px solid ${C.indigo}` : `1px solid ${C.border}`,
                  maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}>{item.apt.name}</button>
              ))}
            </div>
          </div>

          <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{previewItem.apt.name}</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: C.indigo }}>{previewItem.res.total}점</span>
            </div>

            {/* Breakdown bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(previewItem.res.cats).map(([k, c]) => {
                const w = previewItem.res.weights[k] ?? 0;
                const contribution = Math.round(c.total * w / 100);
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: catCol[k], minWidth: 32 }}>{CAT_LABELS[k] || k}</span>
                    <div style={{ flex: 1, height: 20, background: C.slate100, borderRadius: 4, position: "relative", overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(contribution * 2, 100)}%`, height: "100%", background: catBg[k], borderRadius: 4,
                        transition: "width .3s", opacity: w === 0 ? 0.3 : 1
                      }} />
                      <span style={{ position: "absolute", left: 6, top: 2, fontSize: 10, fontWeight: 700, color: catCol[k] }}>
                        {c.total}점
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: C.muted, minWidth: 20, textAlign: "right" }}>{w}%</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: catCol[k], minWidth: 24, textAlign: "right" }}>{contribution}</span>
                  </div>
                );
              })}
            </div>

            {/* Sub-scores detail */}
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 3 }}>
              {Object.entries(previewItem.res.cats).map(([k, c]) => {
                const w = previewItem.res.weights[k] ?? 0;
                return (
                  <span key={k} style={{ fontSize: 11, color: catCol[k], background: catBg[k], padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
                    {CAT_LABELS[k] || k} {c.total}×{w}%={Math.round(c.total * w / 100)}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
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

      {/* Expert Applications Section */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>전문가 신청 관리</div>
        <div style={{ fontSize: 11, color: C.muted }}>{admin.users.length}건</div>
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
            {admin.selectedStatus === "pending" ? "대기중인 신청이 없습니다" : admin.selectedStatus === "suspended" ? "정지된 사용자가 없습니다" : "해당 상태의 사용자가 없습니다"}
          </div>
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
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{user.email}</div>
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
                    disabled={admin.reviewLoading === user.email}
                    onClick={() => admin.handleReview(user.email, "approve")}
                    style={{
                      flex: 1, padding: "10px", fontSize: 13, fontWeight: 700,
                      background: C.green, color: C.white, border: "none", borderRadius: 6,
                      cursor: admin.reviewLoading === user.email ? "default" : "pointer",
                      opacity: admin.reviewLoading === user.email ? 0.6 : 1, minHeight: 40
                    }}>승인</button>
                  <button
                    disabled={admin.reviewLoading === user.email}
                    onClick={() => admin.handleReview(user.email, "reject")}
                    style={{
                      flex: 1, padding: "10px", fontSize: 13, fontWeight: 700,
                      background: C.white, color: C.red, border: `1.5px solid ${C.red}`, borderRadius: 6,
                      cursor: admin.reviewLoading === user.email ? "default" : "pointer",
                      opacity: admin.reviewLoading === user.email ? 0.6 : 1, minHeight: 40
                    }}>거부</button>
                </div>
              )}

              {/* 강제 로그아웃 — approved 사용자 대상 */}
              {user.status === "approved" && (
                <button
                  disabled={admin.reviewLoading === user.email}
                  onClick={() => admin.handleReview(user.email, "force-logout")}
                  style={{
                    width: "100%", padding: "8px", fontSize: 12, fontWeight: 700,
                    background: C.white, color: "#DC2626", border: "1.5px solid #DC2626", borderRadius: 6,
                    cursor: admin.reviewLoading === user.email ? "default" : "pointer",
                    opacity: admin.reviewLoading === user.email ? 0.6 : 1, marginTop: 4, minHeight: 40
                  }}>강제 로그아웃</button>
              )}

              {/* 재승인 — rejected 또는 suspended 사용자 대상 */}
              {(user.status === "rejected" || user.status === "suspended") && (
                <button
                  disabled={admin.reviewLoading === user.email}
                  onClick={() => admin.handleReview(user.email, "approve")}
                  style={{
                    width: "100%", padding: "8px", fontSize: 12, fontWeight: 700,
                    background: C.white, color: C.green, border: `1.5px solid ${C.green}`, borderRadius: 6,
                    cursor: admin.reviewLoading === user.email ? "default" : "pointer",
                    opacity: admin.reviewLoading === user.email ? 0.6 : 1, marginTop: 4, minHeight: 40
                  }}>재승인</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
