// @vitest-environment node
/**
 * finlife/loans.ts 테스트 — API Key 누락, 정상 응답 파싱, 잘못된 금융권역, 캐싱 헤더
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// rateLimit 모킹
vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FINLIFE_API_KEY;
});

const { default: handlerImport } = await import('./loans.js');
const handler = handlerImport as any;

/** res 목 객체 팩토리 */
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
  } as any;
}

/** 정상 finlife API 응답 팩토리 */
function makeFinlifeResponse() {
  return {
    result: {
      err_cd: "000",
      err_msg: "",
      total_count: "2",
      baseList: [
        { fin_co_no: "0010001", fin_prdt_cd: "P001", kor_co_nm: "테스트은행", fin_prdt_nm: "주택담보대출A", join_way: "영업점", loan_lmt: "5억원" },
        { fin_co_no: "0010002", fin_prdt_cd: "P002", kor_co_nm: "샘플은행", fin_prdt_nm: "주택담보대출B", join_way: "인터넷", loan_lmt: "3억원" },
      ],
      optionList: [
        { fin_co_no: "0010001", fin_prdt_cd: "P001", mrtg_type_nm: "아파트", rpay_type_nm: "원리금균등", lend_rate_type_nm: "고정금리", lend_rate_min: 3.5, lend_rate_max: 4.2, lend_rate_avg: 3.8 },
        { fin_co_no: "0010002", fin_prdt_cd: "P002", mrtg_type_nm: "아파트", rpay_type_nm: "원금균등", lend_rate_type_nm: "변동금리", lend_rate_min: 3.2, lend_rate_max: 5.0, lend_rate_avg: 4.0 },
      ],
    },
  };
}

describe('finlife/loans handler', () => {
  // 에러: API Key 미설정
  it('FINLIFE_API_KEY 없으면 500을 반환한다', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // 에러: GET 이외 메서드
  it('GET이 아닌 메서드는 405를 반환한다', async () => {
    process.env.FINLIFE_API_KEY = 'test-key';
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  // 에러: 잘못된 금융권역 코드
  it('잘못된 금융권역 코드는 400을 반환한다', async () => {
    process.env.FINLIFE_API_KEY = 'test-key';
    const res = makeRes();
    await handler({ method: 'GET', query: { topFinGrpNo: '999999' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // 정상: 금리 데이터 파싱 및 정렬
  it('정상 응답 시 금리 데이터를 파싱하고 금리 낮은 순으로 정렬한다', async () => {
    process.env.FINLIFE_API_KEY = 'test-key';
    const mockResponse = makeFinlifeResponse();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));
    const res = makeRes();
    await handler({ method: 'GET', query: { topFinGrpNo: '020000' }, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      count: 2,
    }));
    const data = res.json.mock.calls[0][0].data;
    // 금리 낮은 순: 샘플은행(3.2) → 테스트은행(3.5)
    expect(data[0].bank).toBe('샘플은행');
    expect(data[0].rateMin).toBe(3.2);
    expect(data[1].bank).toBe('테스트은행');
    expect(data[1].rateMin).toBe(3.5);
    vi.unstubAllGlobals();
  });

  // 정상: 캐싱 헤더 설정
  it('Cache-Control 헤더를 설정한다', async () => {
    process.env.FINLIFE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeFinlifeResponse()),
    }));
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage=3600'));
    vi.unstubAllGlobals();
  });

  // finlife API 에러 코드 → 빈 배열 반환
  it('finlife API 에러 코드 시 빈 배열을 반환한다', async () => {
    process.env.FINLIFE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { err_cd: "010", err_msg: "미등록 인증키", total_count: "0" } }),
    }));
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, data: [] }));
    vi.unstubAllGlobals();
  });

  // 외부 API 장애 → 502
  it('외부 API 장애 시 502를 반환한다', async () => {
    process.env.FINLIFE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(502);
    vi.unstubAllGlobals();
  });
});
