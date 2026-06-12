import { FIELD_META, type FieldMetaEntry } from "@/constants/fieldMeta";
import type { Apt } from "@/types/scoring";

// 데이터 채움률 공유 계산 — 구 전문가 대시보드 인라인 로직(세션 380 추출, 세션 405 폐지 후에도 공유 lib 유지).
// 관리자 인사이트(전체 비-hidden 필드, DataSections adminMode)·소비자 도넛(DATA_SECTIONS 섹션별)이 같은 함수를 호출해 drift 0.
// 모집단(fields)을 호출처가 결정 — 분류·가중·0나눗셈 가드는 한 곳에서만.

export type CompletenessResult = {
  pct: number;
  filled: number;
  estimated: number;
  defaults: number;
  missing: number;
  na: number;
  total: number;
  evalTotal: number;
  estimatedFields: string[];
  defaultFields: string[];
  missingFields: string[];
  naFields: string[];
};

const FM = FIELD_META as Record<string, FieldMetaEntry>;

// fields = 평가 대상 필드 키 배열. apt = 단지 전체(분류 함수가 presaleStage·_fallbackXXX 등 타 필드 참조).
// 분류 우선순위(배타 else-if): na(적용대상아님) → missing → estimated(0.5 가중) → default → filled.
export function computeCompleteness(fields: string[], apt: Apt): CompletenessResult {
  let filled = 0,
    estimated = 0,
    defaults = 0,
    missing = 0,
    na = 0;
  const estimatedFields: string[] = [];
  const defaultFields: string[] = [];
  const missingFields: string[] = [];
  const naFields: string[] = [];
  let total = 0;
  for (const k of fields) {
    const meta = FM[k];
    if (!meta) continue; // meta 없는 필드는 평가 모집단에서 제외(실발동 0 — DATA_SECTIONS·138 전부 meta 보유)
    total++;
    const v = apt[k];
    // 적용 대상 아님이 최우선 — 분양 중 아닌 단지는 presale/competition 필드가 평가 대상 아님
    if (meta.isNotApplicable && meta.isNotApplicable(v, apt)) {
      na++;
      naFields.push(meta.label);
    } else if (v === undefined || v === null || v === "") {
      missing++;
      missingFields.push(meta.label);
    } else if (meta.isEstimated && meta.isEstimated(v, apt)) {
      estimated++;
      estimatedFields.push(meta.label);
    } else if (meta.isDefault && meta.isDefault(v)) {
      defaults++;
      defaultFields.push(`${meta.label} (${meta.fmt ? meta.fmt(v, apt) : v})`);
    } else {
      filled++;
    }
  }
  const evalTotal = total - na;
  const pct = evalTotal > 0 ? Math.round(((filled + estimated * 0.5) / evalTotal) * 100) : 0;
  return {
    pct,
    filled,
    estimated,
    defaults,
    missing,
    na,
    total,
    evalTotal,
    estimatedFields,
    defaultFields,
    missingFields,
    naFields,
  };
}
