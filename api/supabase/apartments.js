// TODO(scalability): apartments_flat VIEW에 prices(apartment_id, recorded_at DESC) 인덱스 추가 권장 (SC-1)
/**
 * GET /api/supabase/apartments
 *
 * 9개 테이블 JOIN → 기존 apartments.json과 동일한 평탄 형태 반환
 * 응답: { ok: true, data: [...], count: N, fetchedAt: "..." }
 *
 * 쿼리 파라미터:
 *   ?region=경기          지역 필터
 *   ?gu=의왕시            시군구 필터
 *   ?limit=100            페이지 크기 (기본: 전체)
 *   ?offset=0             오프셋
 */
import { getSupabase } from "../_lib/supabase.js";

const BATCH_SIZE = 1000;

/** 필터 적용된 새 쿼리 객체 생성 (배치마다 새로 빌드 필요) */
function buildQuery(supabase, region, gu, withCount) {
  let q = supabase.from("apartments_flat").select("*", withCount ? { count: "exact" } : {});
  if (region) q = q.eq("region", region);
  if (gu) q = q.eq("gu", gu);
  return q;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();
    const { region, gu } = req.query;
    const hasExplicitPagination = req.query.limit || req.query.offset;

    let allData;
    let totalCount;

    if (hasExplicitPagination) {
      // 명시적 limit/offset → 기존 단일 쿼리 (하위 호환)
      const safeLimit = Math.max(1, Math.min(parseInt(req.query.limit || "10000", 10) || 10000, 10000));
      const safeOffset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);
      let query = buildQuery(supabase, region, gu, true);
      query = query.range(safeOffset, safeOffset + safeLimit - 1);
      const { data, error, count } = await query;
      if (error) {
        console.error("Supabase query error:", error);
        return res.status(500).json({ ok: false, error: "데이터 조회 중 오류가 발생했습니다" });
      }
      allData = data || [];
      totalCount = count;
    } else {
      // 기본: 배치 페이지네이션으로 전체 데이터 조회 (PostgREST max_rows=1000 우회)
      const firstQuery = buildQuery(supabase, region, gu, true).range(0, BATCH_SIZE - 1);
      const { data: firstBatch, error, count } = await firstQuery;
      if (error) {
        console.error("Supabase query error:", error);
        return res.status(500).json({ ok: false, error: "데이터 조회 중 오류가 발생했습니다" });
      }
      allData = firstBatch || [];
      totalCount = count;

      // 추가 배치 필요 시 순차 요청
      if (count && count > BATCH_SIZE) {
        const remaining = Math.ceil((count - BATCH_SIZE) / BATCH_SIZE);
        for (let i = 1; i <= remaining; i++) {
          const offset = i * BATCH_SIZE;
          const batchQuery = buildQuery(supabase, region, gu, false).range(offset, offset + BATCH_SIZE - 1);
          const { data: batch, error: batchError } = await batchQuery;
          if (batchError) {
            console.error(`Batch ${i} error:`, batchError);
            break;
          }
          if (batch) allData = allData.concat(batch);
          if (!batch || batch.length < BATCH_SIZE) break;
        }
      }
    }

    // null → 기본값 정리 (기존 JSON과 호환)
    const cleaned = allData.map(sanitize);

    // 데이터 최신성: 가장 최근 updated_at
    const { data: latestRow } = await supabase
      .from("apartments")
      .select("updated_at")
      .not("updated_at", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const dataUpdatedAt = latestRow?.updated_at ?? null;

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      ok: true,
      data: cleaned,
      count: totalCount ?? cleaned.length,
      fetchedAt: new Date().toISOString(),
      dataUpdatedAt,
    });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}

/**
 * null → 기본값으로 정리 (기존 JSON 호환 + 스코어링 엔진 안전)
 * CLAUDE.md: "위험 필드 null → 비관적 기본값, 혜택 필드 null → 0"
 */
function sanitize(row) {
  return {
    // 추정값 추적 플래그 (ExpertDataCompleteness에서 사용)
    _fallbackPir: row.pir == null,
    _fallbackPsr: row.psr == null,
    _fallbackJeonseRate: row.jeonseRate == null,
    _fallbackSupplyRatio: row.supplyRatio == null,
    _fallbackUnsoldRate: row.unsoldRate == null,
    _fallbackBuilderDebt: row.builderDebtRatio == null,
    _fallbackDataReliability: row.dataReliability == null,
    _fallbackNearbyMedian: row.nearbyMedian == null && row.naverNearbyMedian != null,
    _fallbackNearbyBuildYear: row.nearbyBuildYear == null && row.naverBuildYear != null,
    _fallbackAvgFloor: row.avgFloor == null && row.naverAvgFloor != null,
    id: row.id,
    name: row.name,
    dong: row.dong ?? "",
    gu: row.gu ?? "",
    region: row.region,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    builder: row.builder ?? "",
    layout: row.layout ?? null,
    units: row.units ?? 0,
    unsold: (row.unsold != null && (row.units ?? 0) > 1 && row.unsold >= (row.units ?? 0)) ? null : (row.unsold ?? null),
    unsoldRate: (row.units ?? 0) <= 1 ? null
      : (row.unsold != null && row.unsold >= (row.units ?? 0)) ? null
      : (row.unsoldRate ?? 50),
    completion: row.completion ?? "",
    heating: row.heating ?? null,
    maxFloor: row.maxFloor ?? null,
    parkingRatio: row.parkingRatio ?? null,
    floorAreaRatio: row.floorAreaRatio ?? null,
    exclusiveRatio: row.exclusiveRatio ?? null,
    energyGrade: row.energyGrade ?? null,
    greenBldg: row.greenBldg ?? null,
    quakeDesign: row.quakeDesign ?? null,
    hasPool: row.hasPool ?? null,
    announcementUrl: row.announcementUrl ?? null,
    // 혜택 (null → 0/false)
    discountPct: row.discountPct ?? 0,
    loanFree: row.loanFree ?? false,
    loanFreePct: row.loanFreePct ?? 0,
    optionFree: row.optionFree ?? false,
    optionValue: row.optionValue ?? 0,
    balconyFree: row.balconyFree ?? false,
    balconyValue: row.balconyValue ?? 0,
    cashback: row.cashback ?? 0,
    contractDiscount: row.contractDiscount ?? false,
    benefits: row.benefits ?? [],
    // 미래가치
    transitDev: row.transitDev ?? null,
    devDist: row.devDist ?? null,
    cityDev: row.cityDev ?? null,
    industryDev: row.industryDev ?? null,
    // 환경
    view: row.view ?? null,
    sunlight: row.sunlight ?? null,
    noise: row.noise ?? null,
    noxious: row.noxious ?? [],
    noxiousDist: row.noxiousDist ?? null,
    // 분양가
    area: row.area ?? 0,
    price: row.price ?? 0,
    pp: row.pp ?? 0,
    // 인프라
    hospital: row.hospital ?? 0,
    hospitalDist: row.hospitalDist ?? null,
    mart: row.mart ?? 0,
    conv: row.conv ?? 0,
    cafe: row.cafe ?? 0,
    culture: row.culture ?? 0,
    bank: row.bank ?? 0,
    pharmacy: row.pharmacy ?? 0,
    martDist: row.martDist ?? null,
    convDist: row.convDist ?? null,
    parkDist: row.parkDist ?? null,
    cafeDist: row.cafeDist ?? null,
    cultureDist: row.cultureDist ?? null,
    bankDist: row.bankDist ?? null,
    pharmacyDist: row.pharmacyDist ?? null,
    park: row.park ?? 0,
    subwayDist: row.subwayDist ?? 9999,
    nearbyFacilities: row.nearbyFacilities ?? [],
    // 학군
    schoolScore: row.schoolScore ?? 50,
    schoolGrade: row.schoolGrade ?? "",
    nearbySchools: row.nearbySchools ?? [],
    // 교통
    busRoutes: row.busRoutes ?? 0,
    icDist: row.icDist ?? 99,
    ktxDist: row.ktxDist ?? 99,
    // 건설사
    builderDebtRatio: row.builderDebtRatio ?? 250,
    builderCreditGrade: row.builderCreditGrade ?? null,
    // 지역
    popGrowth: row.popGrowth ?? null,
    netMigration: row.netMigration ?? null,
    supplyRatio: row.supplyRatio ?? 150,
    // 실거래 (위험 필드 → 비관적 기본값)
    nearbyMedian: row.nearbyMedian ?? row.naverNearbyMedian ?? null,
    recentTrades6m: row.recentTrades6m ?? 0,
    nearbyBuildYear: row.nearbyBuildYear ?? row.naverBuildYear ?? null,
    avgFloor: row.avgFloor ?? row.naverAvgFloor ?? null,
    floorRange: row.floorRange ?? null,
    jeonseRate: row.jeonseRate ?? 40,
    pir: row.pir ?? 10,
    psr: row.psr ?? 1.5,
    // 규제/보증 (engine.js scoreRisk에서 사용)
    dsr40pass: row.dsr40pass ?? false,
    hugGuarantee: row.hugGuarantee ?? false,
    // 시세 배열 (DetailModal 시세 테이블에서 사용)
    priceByArea: row.priceByArea ?? [],
    rentByArea: row.rentByArea ?? [],
    jeonseByArea: row.jeonseByArea ?? [],
    priceByFloor: row.priceByFloor ?? [],
    // 메타
    dataReliability: row.dataReliability ?? 30,
    // 네이버 교차검증 (null 허용 — 미수집 시 null)
    naverNearbyMedian: row.naverNearbyMedian ?? null,
    naverNearbyAvg: row.naverNearbyAvg ?? null,
    naverJeonseRate: row.naverJeonseRate ?? null,
    naverSellCount: row.naverSellCount ?? null,
    naverJeonseCount: row.naverJeonseCount ?? null,
    naverWolseCount: row.naverWolseCount ?? null,
    naverBuildYear: row.naverBuildYear ?? null,
    naverAvgFloor: row.naverAvgFloor ?? null,
    naverSchoolWalkMin: row.naverSchoolWalkMin ?? null,
    naverNearbyCount: row.naverNearbyCount ?? null,
    naverFetchedAt: row.naverFetchedAt ?? null,
  };
}
