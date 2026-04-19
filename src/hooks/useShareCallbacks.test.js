import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShareCallbacks } from './useShareCallbacks';

describe('useShareCallbacks', () => {
  const makeProps = (overrides = {}) => ({
    scoredMap: new Map([
      [1, { apt: { name: '테스트아파트', price: 40000 }, res: { total: 85 } }],
    ]),
    profile: 'live',
    compIds: [],
    compItems: [],
    openShareSheet: vi.fn(),
    getShareURL: vi.fn(() => 'https://mibunyang.com/?region=서울'),
    filterRegion: '전체',
    budgetMin: '', budgetMax: '',
    areaMin: '', areaMax: '',
    unitsMin: '', unitsMax: '',
    moveInFilter: '전체',
    minScore: '',
    builderTier: '전체',
    benefitOnly: false,
    ...overrides,
  });

  it('handleShareDetail: scoredMap에서 item 찾아 URL 생성', () => {
    const openShareSheet = vi.fn();
    const { result } = renderHook(() => useShareCallbacks(makeProps({ openShareSheet })));

    act(() => { result.current.handleShareDetail(1); });

    expect(openShareSheet).toHaveBeenCalledTimes(1);
    const call = openShareSheet.mock.calls[0][0];
    expect(call.title).toContain('테스트아파트');
    expect(call.url).toContain('detail=1');
    expect(call.url).toContain('profile=live');
  });

  it('handleShareDetail: scoredMap에 없는 id면 openShareSheet 호출 안 함', () => {
    const openShareSheet = vi.fn();
    const { result } = renderHook(() => useShareCallbacks(makeProps({ openShareSheet })));

    act(() => { result.current.handleShareDetail(999); });

    expect(openShareSheet).not.toHaveBeenCalled();
  });

  it('handleShareCompare: compIds.length < 2 면 호출 안 함', () => {
    const openShareSheet = vi.fn();
    const { result } = renderHook(() => useShareCallbacks(makeProps({
      openShareSheet, compIds: [1], compItems: [{ apt: { name: 'A' } }],
    })));

    act(() => { result.current.handleShareCompare(); });

    expect(openShareSheet).not.toHaveBeenCalled();
  });

  it('handleShareCompare: 2개 이상이면 URL에 compare= 포함', () => {
    const openShareSheet = vi.fn();
    const { result } = renderHook(() => useShareCallbacks(makeProps({
      openShareSheet,
      compIds: [1, 2],
      compItems: [{ apt: { name: 'A' } }, { apt: { name: 'B' } }],
    })));

    act(() => { result.current.handleShareCompare(); });

    expect(openShareSheet).toHaveBeenCalledTimes(1);
    const call = openShareSheet.mock.calls[0][0];
    expect(call.text).toBe('A vs B');
    expect(call.url).toContain('compare=1,2');
  });

  it('handleShareFilters: 활성 필터 없으면 "전체 조건" 텍스트', () => {
    const openShareSheet = vi.fn();
    const { result } = renderHook(() => useShareCallbacks(makeProps({ openShareSheet })));

    act(() => { result.current.handleShareFilters(); });

    expect(openShareSheet).toHaveBeenCalledTimes(1);
    expect(openShareSheet.mock.calls[0][0].text).toBe('전체 조건');
  });

  it('handleShareFilters: 여러 필터 활성화되면 · 구분자로 합침', () => {
    const openShareSheet = vi.fn();
    const { result } = renderHook(() => useShareCallbacks(makeProps({
      openShareSheet,
      filterRegion: '서울',
      budgetMin: '3',
      budgetMax: '5',
      moveInFilter: '즉시입주',
      benefitOnly: true,
    })));

    act(() => { result.current.handleShareFilters(); });

    const text = openShareSheet.mock.calls[0][0].text;
    expect(text).toContain('서울');
    expect(text).toContain('3~5억');
    expect(text).toContain('즉시입주');
    expect(text).toContain('혜택');
  });
});
