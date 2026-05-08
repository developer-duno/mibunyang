// @vitest-environment node
// @ts-check
/**
 * dart/builders.js 테스트 — estimateCreditGrade 경계값, debtRatio 계산
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.DART_KEY = 'test-dart-key';
  vi.clearAllMocks();
});

describe('dart/builders payload validation', () => {
  it('builders 항목이 문자열이 아니면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['GS嫄댁꽕', 123] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toBe('builders must contain strings only');
  });

  it('builders 항목이 빈 문자열이면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['   '] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toBe('invalid builder name');
  });

  it('builders 항목이 너무 길면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['a'.repeat(41)] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toBe('invalid builder name');
  });
});

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

// fetch 모킹
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: handlerImport } = await import('./builders.js');
/** @type {any} */
const handler = handlerImport;

/** res 목 객체 팩토리 */
function makeRes() {
  return /** @type {any} */ ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  });
}

/**
 * DART 재무제표 응답 팩토리
 * @param {number} debtAmt
 * @param {number} equityAmt
 */
function makeDartResponse(debtAmt, equityAmt) {
  return {
    ok: true,
    json: () => Promise.resolve({
      status: '000',
      list: [
        { fs_div: 'CFS', sj_div: 'BS', account_nm: '부채총계', thstrm_amount: String(debtAmt) },
        { fs_div: 'CFS', sj_div: 'BS', account_nm: '자본총계', thstrm_amount: String(equityAmt) },
      ],
    }),
  };
}

describe('dart/builders handler', () => {
  // 에러: POST 이외 메서드
  it('POST가 아닌 메서드는 405를 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: DART_KEY 미설정
  it('DART_KEY 미설정 시 500을 반환한다', async () => {
    delete process.env.DART_KEY;
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['GS건설'] } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    process.env.DART_KEY = 'test-dart-key';
  });

  // 에러: builders 배열 누락
  it('builders 배열이 없으면 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 에러: 빈 배열
  it('빈 builders 배열은 400을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: [] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상: debtRatio 계산 및 creditGrade
  // debtRatio = Math.round(debtAmt / equityAmt * 10) / 10
  // 예: 부채 5000, 자본 100 → 5000/100 = 50 → Math.round(500)/10 = 50.0
  it('debtRatio를 올바르게 계산하고 creditGrade를 매핑한다', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(5000, 100)); // 50.0
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['GS건설'] } }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['GS건설'].debtRatio).toBe(50);
    expect(data['GS건설'].creditGrade).toBe('A'); // <= 100 → A
  });

  // estimateCreditGrade 경계값 테스트 (간접)
  it('debtRatio 100 → A', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(10000, 100)); // 100.0
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['현대건설'] } }, res);
    expect(res.json.mock.calls[0][0].data['현대건설'].creditGrade).toBe('A');
  });

  it('debtRatio 101 → A-', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(10100, 100)); // 101.0
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['대우건설'] } }, res);
    expect(res.json.mock.calls[0][0].data['대우건설'].creditGrade).toBe('A-');
  });

  it('debtRatio 151 → BBB', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(15100, 100)); // 151.0
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['삼성물산'] } }, res);
    expect(res.json.mock.calls[0][0].data['삼성물산'].creditGrade).toBe('BBB');
  });

  it('debtRatio 201 → BB', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(20100, 100)); // 201.0
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['DL이앤씨'] } }, res);
    expect(res.json.mock.calls[0][0].data['DL이앤씨'].creditGrade).toBe('BB');
  });

  it('debtRatio 251 → B', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(25100, 100)); // 251.0
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['HDC현대산업개발'] } }, res);
    expect(res.json.mock.calls[0][0].data['HDC현대산업개발'].creditGrade).toBe('B');
  });

  it('debtRatio 351 → CCC', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(35100, 100)); // 351.0
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['포스코이앤씨'] } }, res);
    expect(res.json.mock.calls[0][0].data['포스코이앤씨'].creditGrade).toBe('CCC');
  });

  // 매핑되지 않은 건설사는 결과에서 제외
  it('BUILDER_CORP_CODES에 없는 건설사는 결과에서 제외된다', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['무명건설'] } }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['무명건설']).toBeUndefined();
  });

  // DART API 실패 시 해당 건설사 제외
  it('DART API 실패 시 해당 건설사는 결과에서 제외된다', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['GS건설'] } }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data['GS건설']).toBeUndefined();
    expect(res.json.mock.calls[0][0].ok).toBe(true);
  });

  // 캐시 헤더
  it('Cache-Control 헤더를 설정한다', async () => {
    mockFetch.mockResolvedValue(makeDartResponse(100, 200));
    const res = makeRes();
    await handler({ method: 'POST', body: { builders: ['GS건설'] } }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=86400'));
  });
});
