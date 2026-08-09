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
import { withHandler } from "../_lib/handler.js";
import { validateApartmentListQuery } from "../_lib/proxyValidation.js";
import { excludeLeaseUnits } from "../../src/constants/leaseTypes.mjs";

const BATCH_SIZE = 1000;

/** 필터 적용된 새 쿼리 객체 생성 (배치마다 새로 빌드 필요) */
function buildQuery(supabase: any, region: any, gu: any, withCount: boolean) {
  let q = supabase.from("apartments_flat").select("*", withCount ? { count: "exact" } : {}).order("id");
  if (region) q = q.eq("region", region);
  if (gu) q = q.eq("gu", gu);
  return q;
}

export default withHandler({ method: "GET", rateLimit: "proxy", handler: async (req, res) => {
  try {
    const supabase = getSupabase();
    const validation = validateApartmentListQuery(req.query);
    if (!validation.ok) {
      return res.status(validation.status).json({ ok: false, error: validation.error });
    }
    const { region, gu, limit, offset, hasExplicitPagination } = validation.query;

    let allData;

    if (hasExplicitPagination) {
      // 명시적 limit/offset → 기존 단일 쿼리 (하위 호환).
      // exact count 요청을 끈다 — 응답 count 가 "임대형 제외 후 실제 반환 건수"로 바뀌면서
      // DB 전체 건수를 쓸 곳이 없어졌다(이 브랜치는 배치 반복도 안 한다).
      let query = buildQuery(supabase, region, gu, false);
      query = query.range(offset, offset + limit - 1);
      const { data, error } = await query;
      if (error) {
        console.error("Supabase query error:", error);
        return res.status(500).json({ ok: false, error: "데이터 조회 중 오류가 발생했습니다" });
      }
      allData = data || [];
    } else {
      // 기본: 배치 페이지네이션으로 전체 데이터 조회 (PostgREST max_rows=1000 우회)
      const firstQuery = buildQuery(supabase, region, gu, true).range(0, BATCH_SIZE - 1);
      const { data: firstBatch, error, count } = await firstQuery;
      if (error) {
        console.error("Supabase query error:", error);
        return res.status(500).json({ ok: false, error: "데이터 조회 중 오류가 발생했습니다" });
      }
      allData = firstBatch || [];

      // 추가 배치 필요 시 병렬 요청
      if (count && count > BATCH_SIZE) {
        const remaining = Math.ceil((count - BATCH_SIZE) / BATCH_SIZE);
        const batchPromises = [];
        for (let i = 1; i <= remaining; i++) {
          const offset = i * BATCH_SIZE;
          batchPromises.push(buildQuery(supabase, region, gu, false).range(offset, offset + BATCH_SIZE - 1));
        }
        const results = await Promise.allSettled(batchPromises);
        for (const result of results) {
          if (result.status === "fulfilled" && result.value.data) {
            allData = allData.concat(result.value.data);
          } else if (result.status === "rejected") {
            console.error("Batch error:", result.reason);
          } else if (result.value?.error) {
            console.error("Batch query error:", result.value.error);
          }
        }
      }
    }

    // 임대형 제외 — 정적 JSON(collect-data.mjs writeOutputs)과 같은 기준.
    // 현재 production 은 VITE_USE_SUPABASE=false 라 이 엔드포인트를 아무도 안 부르지만,
    // 나중에 Supabase 모드로 켰을 때 임대형이 되살아나는 잠복 회귀를 막으려고 여기도 건다.
    // DB 쿼리(not.in)가 아니라 JS 필터인 이유: SQL NOT IN 은 NULL 을 통째로 떨궈
    // presaleType 미수집 단지(전체의 약 36%)까지 사라진다.
    const visible = excludeLeaseUnits(allData);

    // null → 기본값 정리 (기존 JSON과 호환)
    const cleaned = visible.map(sanitize);

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
      count: cleaned.length,
      fetchedAt: new Date().toISOString(),
      dataUpdatedAt,
    });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});

/** 추정값 추적 플래그 11개 (ExpertDataCompleteness에서 사용) */
function sanitizeFallbackFlags(row: any) {
  return {
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
    _fallbackCancelRatio6m: row.cancelRatio6m == null,
  };
}

/** 위치·건물 기본 필드 (unsold/unsoldRate 특수 로직 포함) */
function sanitizeBasics(row: any) {
  const units = row.units ?? 0;
  return {
    id: row.id,
    name: row.name,
    dong: row.dong ?? "",
    gu: row.gu ?? "",
    region: row.region,
    address: row.address ?? null,
    roadAddress: row.roadAddress ?? null,
    district: row.district ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    builder: row.builder ?? "",
    avgMaintenanceCost: row.avgMaintenanceCost ?? null,
    primaryDirection: row.primaryDirection ?? null,
    heatFuel: row.heatFuel ?? null,
    corridorType: row.corridorType ?? null,
    buildingCoverageRatio: row.buildingCoverageRatio ?? null,
    layout: row.layout ?? null,
    floors: row.floors ?? null,
    units,
    // 세션 446: unsold(미분양 세대수)는 raw 보존 (collect-data·VIEW 와 동일). 기존 `unsold>=units → null`
    //   무력화는 세대수를 null 화해 '미분양만 보기' 필터에서 사라지거나 '입주완료'로 둔갑시키던 잠복 P1
    //   (세션445 AptCard moveInDone 함정과 동형). 폭발한 건 률(units=회차 공급분 오류)이지 세대수가 아님.
    unsold: row.unsold ?? null,
    // 세션 445: 미분양률(률) 무력화 경계를 VIEW·정적 JSON·collect-data 와 동일하게 ">100 → null" 로 통일.
    //   기존 `?? 50` 폴백은 폭발값을 50 으로 가려 점수가 임의로 매겨지던 진앙. units<=1 또는
    //   unsoldRate>100 이면 null(중립), 그 외 raw.
    unsoldRate: units <= 1 ? null
      : (row.unsoldRate != null && row.unsoldRate > 100) ? null
      : (row.unsoldRate ?? null),
    updatedAt: row.updatedAt ?? null,
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
  };
}

/** 혜택 10개 (null → 0/false) */
function sanitizeBenefits(row: any) {
  return {
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
  };
}

/** 미래가치 + 환경 9개 */
function sanitizeEnvironment(row: any) {
  return {
    transitDev: row.transitDev ?? null,
    devDist: row.devDist ?? null,
    cityDev: row.cityDev ?? null,
    industryDev: row.industryDev ?? null,
    view: row.view ?? null,
    sunlight: row.sunlight ?? null,
    noise: row.noise ?? null,
    noxious: row.noxious ?? [],
    noxiousDist: row.noxiousDist ?? null,
  };
}

/** 분양가 + 인프라 + 대기질·치안·학군 (29개, 위험 필드 → 비관적 기본값) */
function sanitizeInfra(row: any) {
  return {
    // 분양가
    area: row.area ?? 0,
    price: row.price ?? 0,
    pp: row.pp ?? 0,
    // 인프라 (시설 카운트 + 거리)
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
    childcare: row.childcare ?? 0,
    childcareDist: row.childcareDist ?? null,
    emergency: row.emergency ?? 0,
    emergencyDist: row.emergencyDist ?? null,
    police: row.police ?? 0,
    policeDist: row.policeDist ?? null,
    // 대기질·치안·학군 (인라인 — 그룹당 1~3필드라 별도 헬퍼 과잉)
    airQuality: row.airQuality ?? null,
    crimeSafetyGrade: row.crimeSafetyGrade ?? null,
    schoolScore: row.schoolScore ?? 50,
    schoolGrade: row.schoolGrade ?? "",
    nearbySchools: row.nearbySchools ?? [],
    nearbyChildcare: row.nearbyChildcare ?? [],
  };
}

/** 교통 6개 */
function sanitizeTransport(row: any) {
  return {
    busRoutes: row.busRoutes ?? 0,
    icDist: row.icDist ?? 99,
    ktxDist: row.ktxDist ?? 99,
    subwayName: row.subwayName ?? null,
    subwayLines: row.subwayLines ?? null,
    busStopNames: row.busStopNames ?? null,
  };
}

/** 건설사 + 지역 + KOSIS 시장 통계 + 청약 경쟁률 (13개) */
function sanitizeRegion(row: any) {
  return {
    // 건설사
    builderDebtRatio: row.builderDebtRatio ?? 250,
    builderCreditGrade: row.builderCreditGrade ?? null,
    // 지역
    popGrowth: row.popGrowth ?? null,
    netMigration: row.netMigration ?? null,
    supplyRatio: row.supplyRatio ?? 150,
    // KOSIS HUG 시장 통계 (정보성, null 허용)
    housingSupplyLevel: row.housingSupplyLevel ?? null,
    // 공시가격 (MOLIT, 시군구 평균 만원/㎡) — 정보성. 여기 한 줄이 없으면 VIEW 에 값이 있어도
    //   이 응답이 그 필드를 통째로 빼버려 화면엔 영영 "미수집" 으로 보인다(허용목록 방식).
    housingPrice: row.housingPrice ?? null,
    priceIndex: row.priceIndex ?? null,
    avgPriceSqm: row.avgPriceSqm ?? null,
    newSupply: row.newSupply ?? null,
    initialSaleRate: row.initialSaleRate ?? null,
    landCostRatio: row.landCostRatio ?? null,
    // 청약 경쟁률
    competitionRate: row.competitionRate ?? null,
    competitionSupply: row.competitionSupply ?? null,
    competitionApplicants: row.competitionApplicants ?? null,
    // 무순위 공고 이벤트 (apartments_flat LEFT JOIN ae)
    unsoldEventCount: row.unsoldEventCount ?? 0,
    lastUnsoldEventAt: row.lastUnsoldEventAt ?? null,
  };
}

/** 실거래 위험 필드 + 규제/보증 + 시세 배열 (16개, 네이버 폴백 포함) */
function sanitizeTransaction(row: any) {
  return {
    // 실거래 (위험 필드 → 비관적 기본값, 네이버 폴백)
    nearbyMedian: row.nearbyMedian ?? row.naverNearbyMedian ?? null,
    recentTrades6m: row.recentTrades6m ?? 0,
    nearbyBuildYear: row.nearbyBuildYear ?? row.naverBuildYear ?? null,
    avgFloor: row.avgFloor ?? row.naverAvgFloor ?? null,
    floorRange: row.floorRange ?? null,
    jeonseRate: row.jeonseRate ?? 40,
    pir: row.pir ?? 10,
    psr: row.psr ?? 1.5,
    cancelRatio6m: row.cancelRatio6m ?? null,
    // 규제/보증 (engine.js scoreRisk에서 사용)
    isRegulated: row.isRegulated ?? false,
    dsr40pass: row.dsr40pass ?? false,
    // hugGuarantee 는 null 보존 (세션 508, unsoldRate 세션445 선례).
    //   수집률 0% 인데 `?? false` 로 강제하면 "모름"이 "보증 없음"으로 굳어 전 단지가 위험 페널티를 먹는다.
    //   점수 엔진(scoreRisk)이 null=무페널티 / false=+40 을 명시 처리한다.
    hugGuarantee: row.hugGuarantee ?? null,
    // 시세 배열 (DetailModal 시세 테이블)
    priceByArea: row.priceByArea ?? [],
    rentByArea: row.rentByArea ?? [],
    jeonseByArea: row.jeonseByArea ?? [],
    priceByFloor: row.priceByFloor ?? [],
  };
}

/** 네이버 교차검증 11개 (null 허용 — 미수집 시 null) */
function sanitizeNaverCross(row: any) {
  return {
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

/** 네이버 분양정보 19개 (pre.land.naver.com — null 허용) */
function sanitizePresale(row: any) {
  return {
    presaleMinPrice: row.presaleMinPrice ?? null,
    presaleMaxPrice: row.presaleMaxPrice ?? null,
    presalePp: row.presalePp ?? null,
    presaleType: row.presaleType ?? null,
    presaleStage: row.presaleStage ?? null,
    presaleStageCode: row.presaleStageCode ?? null,
    presaleImageUrl: row.presaleImageUrl ?? null,
    naverPresaleNo: row.naverPresaleNo ?? null,
    naverPresaleSeq: row.naverPresaleSeq ?? null,
    presaleGeneralSupply: row.presaleGeneralSupply ?? null,
    presaleBuildings: row.presaleBuildings ?? null,
    presaleParking: row.presaleParking ?? null,
    presaleInquiry: row.presaleInquiry ?? null,
    presaleFeatures: row.presaleFeatures ?? null,
    presaleMoveIn: row.presaleMoveIn ?? null,
    presaleRecruitDate: row.presaleRecruitDate ?? null,
    presaleSchedule: row.presaleSchedule ?? null,
    presaleHousingType: row.presaleHousingType ?? null,
    presaleFetchedAt: row.presaleFetchedAt ?? null,
  };
}

/**
 * null → 기본값으로 정리 (기존 JSON 호환 + 스코어링 엔진 안전)
 * CLAUDE.md: "위험 필드 null → 비관적 기본값, 혜택 필드 null → 0"
 */
function sanitize(row: any) {
  return {
    ...sanitizeFallbackFlags(row),
    ...sanitizeBasics(row),
    ...sanitizeBenefits(row),
    ...sanitizeEnvironment(row),
    ...sanitizeInfra(row),
    ...sanitizeTransport(row),
    ...sanitizeRegion(row),
    ...sanitizeTransaction(row),
    dataReliability: row.dataReliability ?? 30,
    ...sanitizeNaverCross(row),
    // 건축HUB 에너지 (인라인 — 3필드만)
    elecUsageKwh: row.elecUsageKwh ?? null,
    gasUsageMj: row.gasUsageMj ?? null,
    energyCollectedAt: row.energyCollectedAt ?? null,
    catsCache: row.catsCache ?? null,
    ...sanitizePresale(row),
  };
}
