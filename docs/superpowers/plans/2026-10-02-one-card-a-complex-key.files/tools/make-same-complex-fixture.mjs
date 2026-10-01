// 시험 표본 생성기(파일만 읽음 — DB·네트워크 0). 계획서 가) Task 2 가 쓴다.
// 사용: node F:/mibunyang/.omc/artifacts/session588/make-same-complex-fixture.mjs <출력 파일 절대경로>
// 재료(깃 밖, 세션587 산출물): snapshot.json(10/01 19:07 KST 의 apartments 3,256행) · proto-v1-keys.json(시제품 v1 의 묶음 = 정답지).
// 표본 = 대조군 id 가 속한 "맥락"(뼈대+시도+구 첫 낱말이 같은 행 전부) — 묶음 맥락 규칙이 맥락 전체를 봐야 같은 답을 내기 때문.
// 정답(expectedKeys)은 **시제품**의 열쇠다(시험 대상 모듈로 만들지 않는다).
import { readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2];
if (!out) { console.error("출력 파일 경로가 필요합니다"); process.exit(1); }
const D7 = "F:/mibunyang/.omc/artifacts/session587/";
const snap = JSON.parse(readFileSync(D7 + "snapshot.json", "utf8"));
const proto = JSON.parse(readFileSync(D7 + "proto-v1-keys.json", "utf8"));
/** @type {Map<string, string>} */
const protoKey = new Map();
for (const b of proto) for (const id of b.members) protoKey.set(id, b.key);
const ctxOf = (k) => { const p = k.split("#"); if (p.length !== 6) throw new Error("열쇠가 6칸이 아님: " + k); return `${p[0]}|${p[4]}|${p[5]}`; };
const CONTROL_IDS = [
  // 한 묶음이어야 하는 짝
  "ah-2025910001", "ap-6027802", "ah-2025910188", "ap-6026645", "ah-2026910215", "ap-6028408", "ah-2021910092", "ah-2025910171", "ah-2025930006",
  "ah-2025930019", "ah-2026930001", "ah-2022910274", "ah-2024910171", "ah-2023910064", "ah-2025910014", "ah-2022910021", "ah-2025930047",
  "ap-6028403", "ap-6028448", "ah-2021910042", "ah-2024910065", "ah-2024910024", "ah-2026910102", "ap-6028237", "ah-2022910085", "ah-2022910343",
  "ah-2022910253", "ah-2023910054", "ah-2025910215", "ah-2025910173", "ah-2021910063", "ah-2026910032", "ap-6027766", "ap-6027959",
  // 다른 묶음이어야 하는 짝
  "ah-2025910189", "ap-6027743", "ah-2024910240", "ah-2024910241", "ah-2025910280", "ah-2025910279", "ap-6027058", "ap-6027059",
  "ah-2026910003", "ah-2025930027", "ap-6028499", "ah-2025910268", "ah-2025910269", "ap-6028213", "ap-6028215", "ap-6001350", "ap-6006900",
  "ap-6027481", "ap-6028455", "ah-2026910248", "ap-6028551",
  // 예외 명단(always 7쌍 · isolate 3)
  "ah-2022910158", "ah-2021910105", "ah-2021910188", "ah-2024910086", "ah-2024910123", "ah-2024910225", "ah-2025910011", "ah-2023910008",
  "ah-2025910131", "ap-6027962", "ap-6027955", "ap-6027973", "ap-6025160", "ap-6004117", "ap-6014027",
];
const missing = CONTROL_IDS.filter((id) => !protoKey.has(id));
if (missing.length) { console.error("스냅숏에 없는 대조군 id: " + missing.join(",")); process.exit(1); }
const want = new Set(CONTROL_IDS.map((id) => ctxOf(protoKey.get(id))));
const rows = snap.rows
  .filter((r) => want.has(ctxOf(protoKey.get(r.id))))
  .map((r) => ({ id: r.id, name: r.name, region: r.region, gu: r.gu, lat: r.lat, lng: r.lng, presale_type: r.presale_type, naver_presale_no: r.naver_presale_no, presale_min_price: r.presale_min_price, units: r.units, unit_source: r.unit_source }))
  .sort((a, b) => (a.id < b.id ? -1 : 1));
const expectedKeys = Object.fromEntries(rows.map((r) => [r.id, protoKey.get(r.id)]));
writeFileSync(out, JSON.stringify({ takenAt: snap.takenAt, source: "apartments 스냅숏(세션587) — 단지 이름·좌표는 공개 자료", rows, expectedKeys }, null, 1) + "\n");
console.log(`표본 ${rows.length}행 · 맥락 ${want.size} · 대조군 id ${new Set(CONTROL_IDS).size} → ${out}`);
