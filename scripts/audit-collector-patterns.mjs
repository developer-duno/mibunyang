// @ts-check
/**
 * 수집기 매칭 패턴 audit — findBestMatch guField 오설정 검출.
 *
 * 사고 박제: collect-maintenance.mjs / molit-building-info.mjs 가
 * findBestMatch 를 guField:"kaptName" 으로 호출 → 단지명에 구 이름이
 * 들어있길 기대하는 잘못된 매칭. 매칭률 절반 손실 (조용한 실패).
 *
 * 정상: guField:"address" — MOLIT 단지 주소(as1+as2+as3)에 구 이름 포함 검사.
 *
 * 본 audit:
 *   scripts/collectors/*.mjs (.test.mjs 제외) 에서 findBestMatch 호출 중
 *   guField:"kaptName" 사용을 검출 → 발견 시 exit 1.
 *
 * .test.mjs 제외 이유: _molit-api.test.mjs 는 targetGu 자리에 단지명을
 * 의도적으로 넘기는 guField:"kaptName" 테스트 케이스가 정당하게 존재.
 *
 * exit code: 0=clean, 1=misuse 발견, 2=parse error
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const COLLECTORS_DIR = "scripts/collectors";

/**
 * findBestMatch(...) 호출 중 guField:"kaptName" 사용을 검출.
 * 호출은 여러 줄에 걸칠 수 있어 findBestMatch( 부터 닫는 ) 까지 블록으로 본다.
 *
 * @param {string} text 수집기 파일 본문
 * @returns {{ line: number, snippet: string }[]} 검출된 위치 목록
 */
export function findKaptNameMisuse(text) {
  /** @type {{ line: number, snippet: string }[]} */
  const hits = [];
  const callRe = /findBestMatch\s*\(/g;
  let m;
  while ((m = callRe.exec(text)) !== null) {
    // 호출 시작부터 괄호 균형이 0 이 되는 지점까지 블록 추출
    let depth = 0;
    let i = m.index + m[0].length - 1; // '(' 위치
    const start = m.index;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = text.slice(start, i + 1);
    if (/guField\s*:\s*["']kaptName["']/.test(block)) {
      const line = text.slice(0, start).split("\n").length;
      hits.push({ line, snippet: block.replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

async function main() {
  const files = (await readdir(COLLECTORS_DIR))
    .filter(f => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));

  console.log("=== 수집기 매칭 패턴 audit (findBestMatch guField) ===");

  let misuseCount = 0;
  for (const f of files) {
    const filePath = path.join(COLLECTORS_DIR, f);
    const text = await readFile(filePath, "utf-8");
    const hits = findKaptNameMisuse(text);
    for (const h of hits) {
      misuseCount++;
      console.log(`\n❌ ${COLLECTORS_DIR}/${f}:${h.line}`);
      console.log(`   ${h.snippet}`);
      console.log(`   정정: guField 를 "address" 로 (주소 필드에 구 이름이 포함됨)`);
    }
  }

  console.log(`\n=== summary: ${files.length} collectors 검사, ${misuseCount} misuse ===`);

  if (misuseCount > 0) {
    console.log('\n❌ audit failed. guField:"kaptName" 은 매칭률 손실 버그입니다.');
    process.exit(1);
  }
  console.log("\n✅ all clean");
  process.exit(0);
}

main().catch(err => {
  console.error("audit script error:", err);
  process.exit(2);
});
