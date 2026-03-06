const BUILDER_CORP_CODES = {
  "GS건설": "00120030",
  "현대건설": "00164478",
  "대우건설": "00124540",
  "삼성물산": "00149655",
  "DL이앤씨": "01524093",
  "HDC현대산업개발": "01310269",
  "포스코이앤씨": "00100814",
  "롯데건설": "00120438",
  "SK에코플랜트": "00131799",
  "한화건설": "00424529",
  "호반건설": "00236614",
  "태영건설": "01837845",
  "금호건설": "00106313",
  "대림산업": "01843961",
  "현대엔지니어링": "00349927",
  "쌍용건설": "00138206",
};

function estimateCreditGrade(debtRatio) {
  if (debtRatio <= 100) return "A";
  if (debtRatio <= 150) return "A-";
  if (debtRatio <= 200) return "BBB";
  if (debtRatio <= 250) return "BB";
  if (debtRatio <= 350) return "B";
  return "CCC";
}

function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/,/g, "")) || 0;
}

async function fetchFinancials(dartKey, corpCode) {
  // 보고서 코드 순서: 사업보고서 → 반기 → 1분기 → 3분기
  const reprtCodes = ["11011", "11012", "11013", "11014"];
  const years = [2024, 2023];

  for (const year of years) {
    for (const reprt of reprtCodes) {
      try {
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${dartKey}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reprt}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        if (json.status !== "000" || !json.list) continue;

        // 연결재무제표(CFS) 우선, 없으면 별도(OFS)
        let items = json.list.filter(x => x.fs_div === "CFS" && x.sj_div === "BS");
        if (items.length === 0) {
          items = json.list.filter(x => x.fs_div === "OFS" && x.sj_div === "BS");
        }

        const debt = items.find(x => x.account_nm === "부채총계");
        const equity = items.find(x => x.account_nm === "자본총계");

        if (debt && equity) {
          const debtAmt = parseAmount(debt.thstrm_amount);
          const equityAmt = parseAmount(equity.thstrm_amount);
          if (equityAmt > 0) {
            const debtRatio = Math.round(debtAmt / equityAmt * 10) / 10;
            return { debtRatio, year, reprt };
          }
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const dartKey = process.env.DART_KEY;
  if (!dartKey) {
    res.status(500).json({ ok: false, error: "DART_KEY not configured" });
    return;
  }

  const { builders } = req.body || {};
  if (!Array.isArray(builders) || builders.length === 0) {
    res.status(400).json({ ok: false, error: "builders array required" });
    return;
  }

  try {
    const data = {};
    // 배치 처리: 5개씩 (DART API 분당 제한 방지)
    for (let i = 0; i < builders.length; i += 5) {
      const batch = builders.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async (name) => {
          const corpCode = BUILDER_CORP_CODES[name];
          if (!corpCode) return { name, result: null };
          const fin = await fetchFinancials(dartKey, corpCode);
          return { name, result: fin };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.result) {
          const { debtRatio } = r.value.result;
          data[r.value.name] = {
            debtRatio,
            creditGrade: estimateCreditGrade(debtRatio),
          };
        }
      }
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.json({ ok: true, data });
  } catch (err) {
    console.error("DART API error:", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
}
