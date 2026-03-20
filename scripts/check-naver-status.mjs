#!/usr/bin/env node
/**
 * 네이버 수집기 상태 모니터링
 * 사용: node scripts/check-naver-status.mjs
 * 옵션: --watch  (30초마다 자동 체크)
 */
import { loadEnv, getSupabase } from "./collectors/_shared.mjs";

loadEnv();
const sb = getSupabase();
const isWatch = process.argv.includes("--watch");

async function check() {
  const now = new Date().toISOString().slice(0, 19);

  // 최근 수집 시간
  const { data: latest } = await sb
    .from("complexes")
    .select("complex_name, last_crawled_at")
    .not("last_crawled_at", "is", null)
    .order("last_crawled_at", { ascending: false })
    .limit(1);

  const lastTime = latest?.[0]?.last_crawled_at;
  const lastName = latest?.[0]?.complex_name;
  const ago = lastTime ? Math.round((Date.now() - new Date(lastTime).getTime()) / 1000) : null;

  // 오늘 수집 건수
  const today = new Date().toISOString().slice(0, 10);
  const { count: todayCount } = await sb
    .from("complexes")
    .select("*", { count: "exact", head: true })
    .gte("last_crawled_at", `${today}T00:00:00`);

  // articles 활성 매물 수
  const { count: activeArticles } = await sb
    .from("articles")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  // heat_fuel 채움 (네이버 상세 수집 확인)
  const { count: heatFuelCount } = await sb
    .from("complexes")
    .select("*", { count: "exact", head: true })
    .not("heat_fuel", "is", null);

  const status = ago === null ? "❌ 수집 기록 없음"
    : ago < 120 ? "✅ 실행 중"
    : ago < 600 ? `⚠️ 느림 (${ago}초 전)`
    : `❌ 중단됨 (${ago}초 전)`;

  console.log(`[${now}] ${status}`);
  console.log(`  최근: ${lastName} (${ago ? ago + "초 전" : "없음"})`);
  console.log(`  오늘 수집: ${todayCount || 0}건 | 활성 매물: ${activeArticles || 0}건 | heat_fuel: ${heatFuelCount || 0}건`);
  console.log("");

  return ago;
}

if (isWatch) {
  console.log("=== 네이버 수집기 모니터링 (30초 간격) ===\n");
  const run = async () => {
    const ago = await check();
    if (ago !== null && ago > 600) {
      console.log("🚨 수집기가 10분 이상 멈춤! 프로세스 확인 필요.\n");
    }
  };
  await run();
  setInterval(run, 30000);
} else {
  await check();
}
