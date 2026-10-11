// @vitest-environment node
/**
 * supabase/presale-detail.ts 테스트 — 같은 단지 묶음(complex_key) 단위 읽기(세션630)
 * 수집기는 같은 묶음 동점 공고를 id 작은 행에 붙이고 카드는 묶음의 다른 행일 수 있다 → 묶음 전체에서 읽어야 일정이 뜬다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_lib/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

type Row = Record<string, unknown>;
/** 표마다 가짜 행 — 시험마다 갈아 끼운다. */
let db: Record<string, Row[]> = {};
/** 표마다 불린 조건(시험이 "자기 id 만 읽었나"를 본다). */
let calls: { table: string; ops: [string, unknown[]][] }[] = [];

/** supabase 쿼리 빌더 흉내 — eq·in·order·limit 를 실제로 적용하고 await 하면 { data, error }. */
function from(table: string) {
  const call = { table, ops: [] as [string, unknown[]][] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'in', 'order', 'limit']) {
    b[op] = (...args: unknown[]) => { call.ops.push([op, args]); return b; };
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    let rows = [...(db[table] ?? [])];
    for (const [op, args] of call.ops) {
      if (op === 'eq') rows = rows.filter((r) => r[args[0] as string] === args[1]);
      if (op === 'in') rows = rows.filter((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
      if (op === 'order') {
        const [col, opt] = args as [string, { ascending: boolean }];
        const v = (r: Row) => (typeof r[col] === 'number' ? (r[col] as number) : String(r[col]));
        rows.sort((x, y) => (v(x) < v(y) ? -1 : v(x) > v(y) ? 1 : 0) * (opt.ascending ? 1 : -1));
      }
      if (op === 'limit') rows = rows.slice(0, args[0] as number);
    }
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  };
  return b;
}
vi.mock('../_lib/supabase.js', () => ({ getSupabase: () => ({ from }) }));

beforeEach(() => { calls = []; });

const { default: handlerImport } = await import('./presale-detail.js');
const handler = handlerImport as any;

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() } as any;
}
async function get(id: string) {
  const res = makeRes();
  await handler({ method: 'GET', query: { apartment_id: id }, headers: {} }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  return res.json.mock.calls[0][0] as { ok: boolean; schedule: Row | null; units: Row[] };
}

describe('supabase/presale-detail — 묶음 단위 읽기 (세션630)', () => {
  it('열쇠가 있으면 같은 열쇠 행 전부에서 최신 일정 1행 — 카드 행(ah-2)에 일정이 없어도 묶음 다른 행(ah-1)의 공고가 뜬다', async () => {
    db = {
      apartments: [
        { id: 'ah-1', complex_key: 'K' }, { id: 'ah-2', complex_key: 'K' }, { id: 'ah-9', complex_key: 'OTHER' },
      ],
      presale_schedule_official: [
        { apartment_id: 'ah-1', house_manage_no: '2026000001', recruit_date: '2026-05-01' },
        { apartment_id: 'ah-1', house_manage_no: '2025000001', recruit_date: '2025-01-01' },
        { apartment_id: 'ah-9', house_manage_no: '2027000001', recruit_date: '2027-01-01' }, // 다른 묶음 — 더 최신이어도 안 섞인다
      ],
      applyhome_unit_supply: [],
    };
    const body = await get('ah-2');
    expect(body.schedule?.house_manage_no).toBe('2026000001');
    const sched = calls.find((c) => c.table === 'presale_schedule_official');
    const inArg = sched?.ops.find(([op]) => op === 'in')?.[1];
    expect(new Set(inArg?.[1] as string[])).toEqual(new Set(['ah-1', 'ah-2']));
  });

  it('열쇠가 없으면 자기 id 만 — 묶음 조회를 하지 않는다', async () => {
    db = {
      apartments: [{ id: 'ah-1', complex_key: null }, { id: 'ah-2', complex_key: null }],
      presale_schedule_official: [{ apartment_id: 'ah-2', house_manage_no: '2026000002', recruit_date: '2026-06-01' }],
      applyhome_unit_supply: [],
    };
    const body = await get('ah-1');
    expect(body.schedule).toBeNull();
    expect(calls.filter((c) => c.table === 'apartments')).toHaveLength(1);
    const sched = calls.find((c) => c.table === 'presale_schedule_official');
    expect(sched?.ops.find(([op]) => op === 'in')?.[1]).toEqual(['apartment_id', ['ah-1']]);
  });

  it('오피스텔 (오) 카드는 묶음이 있어도 자기 id 만 · 아파트 카드는 묶음에서 (오) 행을 뺀다', async () => {
    db = {
      apartments: [
        { id: 'ah-1', complex_key: 'K', name: '동탄역 디에트르 퍼스티지' },
        { id: 'ah-2', complex_key: 'K', name: '동탄역디에트르퍼스티지(오)' },
      ],
      presale_schedule_official: [
        { apartment_id: 'ah-1', house_manage_no: '2026000001', recruit_date: '2026-01-01' },
        { apartment_id: 'ah-2', house_manage_no: '2026950001', recruit_date: '2026-09-01' }, // 오피스텔 공고 — 더 최신
      ],
      applyhome_unit_supply: [],
    };
    expect((await get('ah-1')).schedule?.house_manage_no).toBe('2026000001');
    expect((await get('ah-2')).schedule?.house_manage_no).toBe('2026950001');
    expect(calls.filter((c) => c.table === 'apartments')).toHaveLength(3); // ah-1: 열쇠+묶음 2회 · ah-2: 열쇠 1회(묶음 조회 안 함)
  });

  it('일정 정렬은 빈 날짜를 뒤로(nullsFirst false)', async () => {
    db = { apartments: [{ id: 'ah-1', complex_key: null }], presale_schedule_official: [], applyhome_unit_supply: [] };
    await get('ah-1');
    const sched = calls.find((c) => c.table === 'presale_schedule_official');
    expect(sched?.ops.find(([op]) => op === 'order')?.[1]).toEqual(['recruit_date', { ascending: false, nullsFirst: false }]);
  });

  it('같은 공고가 묶음 두 행에 붙어 있어도 평형은 (공고번호, 모델번호) 한 벌 · 면적 오름차순', async () => {
    db = {
      apartments: [{ id: 'ah-1', complex_key: 'K' }, { id: 'ah-2', complex_key: 'K' }],
      presale_schedule_official: [],
      applyhome_unit_supply: [
        { apartment_id: 'ah-1', house_manage_no: 'H', model_no: '01', supply_area: 110 },
        { apartment_id: 'ah-2', house_manage_no: 'H', model_no: '01', supply_area: 110 },
        { apartment_id: 'ah-2', house_manage_no: 'H', model_no: '02', supply_area: 80 },
      ],
    };
    const body = await get('ah-1');
    expect(body.units.map((u) => `${u.house_manage_no}|${u.model_no}`)).toEqual(['H|02', 'H|01']);
  });
});
