// 청약홈 supply=0 비율 1주 모니터 (BACKLOG 🟢, 트리거: 2026-05-09 D-7)
//
// 5% 경고 임계값 검증 — `collect-applyhome.mjs` L137-140 의 5% 컷이 적절한지
// applyhome_events 누적 데이터로 거짓 양성 비율 측정.
//
// 실행: node scripts/monitors/applyhome-zero-supply-ratio.mjs
//   - 환경변수: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (mibunyang .env)
// 의도된 결과:
//   - false positive 0건 → 5% 유지 (현재 임계값 적절)
//   - 1건 이상 → 10% 상향 검토 + spec § 3 박제 갱신
//
// 박제 위치: src/components/CLAUDE.md 의 § 백로그 ↔ 본 스크립트로 1줄 측정.

import { createClient } from "@supabase/supabase-js";

// scripts/collectors/_shared.mjs 와 동일한 env 키 사용 (dotenv 없이 process.env)
// 실행 예: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/monitors/...
//   또는 GitHub Actions Secrets 자동 주입
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error("⚠️ SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수 필요.");
  console.error("   로컬 1회 실행: GitHub Actions Secrets 또는 .env 의 값을 export 후 재실행.");
  process.exit(2);
}

const sb = createClient(URL, KEY);

async function main() {
  // 적재 이후 누적 전체
  const { count: totalCount, error: e1 } = await sb
    .from("applyhome_events")
    .select("id", { count: "exact", head: true });
  if (e1) throw e1;

  // supply=0 건수
  const { count: zeroCount, error: e2 } = await sb
    .from("applyhome_events")
    .select("id", { count: "exact", head: true })
    .eq("supply", 0);
  if (e2) throw e2;

  const ratio = totalCount > 0 ? zeroCount / totalCount : 0;
  const pct = (ratio * 100).toFixed(2);

  console.log("=".repeat(60));
  console.log("청약홈 supply=0 비율 모니터 (BACKLOG 🟢)");
  console.log("=".repeat(60));
  console.log(`전체 누적 events: ${totalCount}건`);
  console.log(`supply=0 events:  ${zeroCount}건`);
  console.log(`비율:              ${pct}%`);
  console.log("");

  if (totalCount === 0) {
    console.log("📭 아직 적재 데이터 없음 — 첫 cron 실행 후 재측정 필요.");
    process.exit(0);
  }

  if (ratio === 0) {
    console.log("✅ supply=0 0건 — 5% 임계값 적절. BACKLOG 항목 종료 가능.");
  } else if (ratio < 0.05) {
    console.log(`✅ ${pct}% < 5% — 임계값 안정. 모니터링 계속.`);
  } else if (ratio < 0.10) {
    console.log(`⚠️  ${pct}% — 5%↑ 10%↓. 거짓 양성 1건 이상 가능성. 샘플 점검 권장.`);
  } else {
    console.log(`🚨 ${pct}% > 10% — 즉시 조사. 청약홈 API 응답 형식 변경 가능성 高.`);
  }

  // 최근 7일 분포
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const isoCutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const { count: recent7Total, error: e3 } = await sb
    .from("applyhome_events")
    .select("id", { count: "exact", head: true })
    .gte("recorded_at", isoCutoff);
  const { count: recent7Zero, error: e4 } = await sb
    .from("applyhome_events")
    .select("id", { count: "exact", head: true })
    .gte("recorded_at", isoCutoff)
    .eq("supply", 0);

  if (!e3 && !e4 && recent7Total > 0) {
    const r7 = (recent7Zero / recent7Total * 100).toFixed(2);
    console.log("");
    console.log(`최근 7일: ${recent7Zero}/${recent7Total} (${r7}%)`);
  }
}

main().catch(err => {
  console.error("❌ 모니터 실행 실패:", err.message);
  process.exit(1);
});
