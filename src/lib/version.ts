// M2 b-1 dry-run import (spec L129 task #4 충족 — src/ 측 사용 사례 1건)
// database.types.ts 가 컴파일/import 정상 동작하는지 검증용.
// 실제 사용은 M3+ (api 핸들러 변환 후).
import type { Database as _DatabaseDryRun } from "@/types/database.types";

export const TS_BOOTSTRAP_MILESTONE = "M0" as const;

export function getTsBootstrapVersion(): string {
  return `mibunyang TS bootstrap ${TS_BOOTSTRAP_MILESTONE}`;
}

// 타입 사용처 박제 (typecheck 가 type 정의 자체를 검증하도록 강제)
export type DatabaseTypeRef = _DatabaseDryRun;
