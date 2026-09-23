// @ts-check
/**
 * anon/authenticated 의 "칸 권한 확인을 마친" 쓰기 정책 허용 목록 — 단일 출처.
 *
 * `scripts/_rls-anon-write-policy.test.mjs`(마이그레이션 재생 정적 가드)와
 * `scripts/monitor-collectors.mjs`(감시 ⑩ 주 1회 실측 DB 권한 점검)가 **같은 목록**을
 * 봐야 한다. 복사본이 두 개면 한쪽만 갱신됐을 때 조용히 어긋난다
 * (`.claude/rules/collectors/secret-naming-audit.md` 3-way 동기화와 같은 결).
 *
 * 키 = `"표::정책이름"`, 값 = 칸 권한을 어떻게 좁혔는지 한 줄 사유.
 * @type {Record<string, string>}
 */
export const CLIENT_WRITE_ALLOWLIST = {};
