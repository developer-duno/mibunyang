/**
 * M2c-0 dummy .ts — Vercel runtime 의 .ts 자동 컴파일 검증용.
 *
 * 검증 대상:
 * 1. vercel.json glob (M2a-1 박제) 가 .ts 인식하여 빌드 성공
 * 2. underscore prefix (`_typescript-test.ts`) 자동 함수 제외 가설
 *    (Vercel 가설 = underscore-prefix 파일은 함수 미배포)
 *
 * 본 파일은 c-1 커밋에서 즉시 제거됨. plan v7 c-0 박제.
 */
export const M2C0_VERIFY = "vercel-ts-build-check" as const;
