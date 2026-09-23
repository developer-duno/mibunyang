// 무순위 공고 2회+ 누적 단지 모니터 (BACKLOG 🟡)
//
// applyhome_events 에 같은 단지가 2회 이상 출현하면 = 미분양 시그널.
// DetailModal 차수·이력 섹션 / AptCard 배지 / 시계열 차트 작업의 트리거.
//
// 실행: node scripts/monitors/applyhome-event-recurrence.mjs
//   - 환경변수: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// 결과:
//   - 2회+ 단지 0~수십 → 단지 수 충분할 때 시계열 작업 진입
//   - 단지당 평균 1.75회 (세션 160 1차 적재 보고) → 점진 누적

import { createClient } from "@supabase/supabase-js";

// scripts/collectors/_shared.mjs 와 동일한 env 키 사용
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error("⚠️ SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수 필요.");
  process.exit(2);
}

const sb = createClient(URL, KEY);

async function main() {
  // RPC 가 없으니 클라이언트 측 집계 (페이지네이션).
  //
  // ⚠️ 정렬 없는 OFFSET 페이징은 1,000행을 넘는 표에서 행을 잃는다
  // (.claude/rules/collectors/unordered-pagination-loses-rows.md) — Postgres 는 ORDER BY 가
  // 없으면 페이지마다 다른 표본을 줘 에러 없이 누락된다. applyhome_events 는 PK 가 `id`
  // (SERIAL, 20260502000000_create_applyhome_events.sql) 라 그 컬럼으로 오름차순 커서 페이징한다.
  const PAGE = 1000;
  const counter = new Map();
  let cursor = null;
  let totalRows = 0;

  while (true) {
    let q = sb.from("applyhome_events").select("id,apartment_id").order("id", { ascending: true }).limit(PAGE);
    if (cursor != null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      counter.set(row.apartment_id, (counter.get(row.apartment_id) ?? 0) + 1);
    }
    totalRows += data.length;
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].id;
  }

  const apartmentTotal = counter.size;
  const recurrent = [...counter.entries()].filter(([, n]) => n >= 2);
  const top10 = recurrent.sort((a, b) => b[1] - a[1]).slice(0, 10);

  const avgPerApt = apartmentTotal > 0 ? (totalRows / apartmentTotal).toFixed(2) : "0";

  console.log("=".repeat(60));
  console.log("청약홈 무순위 공고 2회+ 누적 단지 모니터");
  console.log("=".repeat(60));
  console.log(`전체 events:           ${totalRows}건`);
  console.log(`고유 단지 수:           ${apartmentTotal}개`);
  console.log(`단지당 평균 공고 수:    ${avgPerApt}회`);
  console.log(`2회+ 누적 단지:         ${recurrent.length}개`);
  console.log("");

  if (recurrent.length === 0) {
    console.log("📭 아직 2회+ 단지 없음 — 차수 노출 작업 보류.");
    process.exit(0);
  }

  console.log(`🎯 차수 노출 작업 진입 가능 — 2회+ 단지가 ${recurrent.length}개 누적.`);
  if (recurrent.length < 5) {
    console.log("   (5개 미만 → BACKLOG 보류 유지, 누적 더 기다리는 게 안정)");
  } else {
    console.log("   (5개 이상 → DetailModal 차수 섹션 작업 시작 권장)");
  }

  console.log("");
  console.log("Top 10 (가장 많이 누적된 단지):");
  for (const [aptId, n] of top10) {
    console.log(`  ${aptId}: ${n}회`);
  }
}

main().catch(err => {
  console.error("❌ 모니터 실행 실패:", err.message);
  process.exit(1);
});
