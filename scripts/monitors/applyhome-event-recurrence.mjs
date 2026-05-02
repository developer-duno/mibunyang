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
  // RPC 가 없으니 클라이언트 측 집계 (페이지네이션)
  const PAGE = 1000;
  const counter = new Map();
  let from = 0;
  let totalRows = 0;

  while (true) {
    const { data, error } = await sb
      .from("applyhome_events")
      .select("apartment_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      counter.set(row.apartment_id, (counter.get(row.apartment_id) ?? 0) + 1);
    }
    totalRows += data.length;
    if (data.length < PAGE) break;
    from += PAGE;
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
