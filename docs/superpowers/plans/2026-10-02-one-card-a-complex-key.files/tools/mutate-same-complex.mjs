// 변이 시험(열쇠 모듈): 규칙을 하나씩 고장 내고 시험이 빨강이 되는지 본다. 되돌림·판정 규칙은 mutate-lib.mjs 머리말.
// 사용: node mutate-same-complex.mjs <워크트리 절대경로>
import { runMutations } from "./mutate-lib.mjs";

/** @type {Array<[string, string, string]>} */
const MUT = [
  ["M1 묶음 맥락 규칙 끔(무리가 하나여도 토큰을 열쇠에)", "if (clusters.size <= 1) {", "if (clusters.size < 1) {"],
  ["M2 회차 낱말 떼기 끔", "s = stripRoundWords(s);", "s = String(s);"],
  ["M3 대표 = 가장 최근 공고로 뒤집음", "(a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0].id;", "(a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0].id;"],
  ["M4 세대수 순위에서 국토부를 네이버 앞으로", "{ naver_presale: 0, naver: 1, molit: 2, applyhome: 3 }", "{ naver_presale: 2, naver: 1, molit: 0, applyhome: 3 }"],
  ["M5 isolate 무시", "if (k != null) keys.set(id, `${k}#only:${id}`);", "if (k != null) keys.set(id, k);"],
  ["M6 임대 표시를 열쇠에서 뺌", "#L${i.isLease ? 1 : 0}#", "#L0#"],
  ["M7 붙이는 한계 300m → 3km", "export const ATTACH_MAX_M = 300;", "export const ATTACH_MAX_M = 3000;"],
  ["M8 재료 행에서 번호 주인 우선을 끔", "(isPresaleOwner(m) ? 0 : isAh(m) ? 1 : 2)", "(isAh(m) ? 1 : 2)"],
  ["M9 always 무시", "for (const [id, k] of keys) if (k === ka) keys.set(id, kb);", ""],
  ["M10 빈 뼈대 보호 끔", 'i.skel === ""\n      ? `#only:${r.id}`\n      : ', ""],
  ["M11 세대수: 번호 주인이 아니어도 맨 앞 순위", 'm.unit_source === "naver_presale" && !isPresaleOwner(m) ? UNIT_RANK.naver : ', ""],
  ["M12 임대·분양 섞임 확인 끔", 'if (new Set(ms.map((m) => isLeaseUnit(m))).size > 1) why.push("임대·분양 섞임");', ""],
  ["M13 시도 섞임 확인 끔", 'if (new Set(ms.map((m) => m.region || "")).size > 1) why.push("시도 섞임");', ""],
  ["M14 always·isolate 겹침 거부 끔", "if (both.length > 0) throw new Error(", "if (false) throw new Error("],
];

runMutations({
  worktree: process.argv[2],
  target: "scripts/collectors/_same-complex.mjs",
  tests: ["scripts/collectors/_same-complex.test.mjs"],
  mutations: MUT,
  timeoutMs: 120000,
});
