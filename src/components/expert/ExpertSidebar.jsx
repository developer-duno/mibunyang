import { memo, useMemo } from "react";
import { C, gr } from "@/theme";

export const ExpertSidebar = memo(function ExpertSidebar({ scored, selectedId, onSelect, search, setSearch, regionFilter, setRegionFilter, sort, setSort, isMobile, onClose, searchOpen, setSearchOpen }) {
  const regions = useMemo(() => ["전체", ...new Set(scored.map(x => x.apt.region).filter(Boolean))], [scored]);
  const filtered = useMemo(() => {
    let list = scored;
    if (search) list = list.filter(x => (x.apt.name ?? "").includes(search) || (x.apt.gu ?? "").includes(search) || (x.apt.region ?? "").includes(search));
    if (regionFilter !== "전체") list = list.filter(x => x.apt.region === regionFilter);
    if (sort === "total") list = [...list].sort((a, b) => b.res.total - a.res.total);
    else if (sort === "price") list = [...list].sort((a, b) => (a.apt.price ?? 0) - (b.apt.price ?? 0));
    else if (sort === "priceScore") list = [...list].sort((a, b) => b.res.cats.price.total - a.res.cats.price.total);
    return list;
  }, [scored, search, regionFilter, sort]);

  return (
    <div style={{ width: isMobile ? "85vw" : 280, maxWidth: isMobile ? 320 : "none", flexShrink: 0, background: C.card, borderRight: `1px solid ${C.border}`, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {isMobile && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px 0" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>단지 목록</span>
          <button onClick={onClose} aria-label="사이드바 닫기" style={{
            background: "none", border: "none", fontSize: 20, color: C.muted, cursor: "pointer",
            minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center"
          }}>&times;</button>
        </div>
      )}
      <button onClick={() => setSearchOpen(v => !v)} aria-expanded={searchOpen} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 12px", background: searchOpen ? C.indigoLight : C.slate100,
        border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", transition: "background .15s"
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: search ? C.indigo : C.text }}>
          {search ? `검색: "${search}"` : "단지 검색"}
          {(regionFilter !== "전체") && ` · ${regionFilter}`}
        </span>
        <span style={{ fontSize: 10, color: C.muted, transition: "transform .2s", transform: searchOpen ? "rotate(180deg)" : "none" }}>▾</span>
      </button>
      <div style={{
        maxHeight: searchOpen ? 100 : 0, overflow: "hidden",
        transition: "max-height .25s ease", borderBottom: searchOpen ? `1px solid ${C.border}` : "none"
      }}>
        <div style={{ padding: "8px 12px 4px" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="단지명/지역 검색..." aria-label="단지 검색"
            style={{ width: "100%", padding: "8px 10px", fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ padding: "0 12px 8px", display: "flex", gap: 4 }}>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} aria-label="지역 필터"
            style={{ flex: 1, padding: "6px 8px", fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: "pointer" }}>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label="정렬 기준"
            style={{ flex: 1, padding: "6px 8px", fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: "pointer" }}>
            <option value="total">종합순</option>
            <option value="price">저가순</option>
            <option value="priceScore">가격매력순</option>
          </select>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.map((item, idx) => {
          const { apt, res } = item;
          const g2 = gr(res.total);
          const selected = selectedId === apt.id;
          return (
            <button key={apt.id} onClick={() => onSelect(apt.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: selected ? C.indigoLight : "transparent",
                border: "none", borderBottom: `1px solid ${C.bg}`, borderLeft: selected ? `3px solid ${C.indigo}` : "3px solid transparent",
                cursor: "pointer", textAlign: "left", transition: "background .15s" }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, width: 20 }}>{idx + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: selected ? 800 : 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{apt.name}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{apt.region} {apt.gu ?? ""} · {apt.area ?? ""}㎡</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: g2.c }}>{res.total}</div>
                <div style={{ fontSize: 10, color: g2.c }}>{g2.l}</div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: C.muted }}>검색 결과 없음</div>
        )}
      </div>
    </div>
  );
});
