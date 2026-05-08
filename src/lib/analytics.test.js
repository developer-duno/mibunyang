// @ts-check
import { describe, it, expect, vi } from 'vitest';

// @vercel/analytics 모킹
vi.mock('@vercel/analytics', () => ({
  track: vi.fn(),
}));

import { track } from '@vercel/analytics';
import { trackEvent } from './analytics';

// Analytics 래퍼 테스트
describe('trackEvent', () => {
  it('정상: 이벤트명과 props를 track()에 전달', () => {
    trackEvent('tab_switch', { tab: 'map', previous_tab: 'list' });
    expect(track).toHaveBeenCalledWith('tab_switch', { tab: 'map', previous_tab: 'list' });
  });

  it('에러: name이 falsy이면 track() 호출하지 않음', () => {
    /** @type {import('vitest').Mock} */ (track).mockClear();
    trackEvent(/** @type {string} */ (/** @type {unknown} */ (null)), { foo: 'bar' });
    trackEvent('', {});
    trackEvent(/** @type {string} */ (/** @type {unknown} */ (undefined)));
    expect(track).not.toHaveBeenCalled();
  });

  it('에러: track()이 throw해도 앱이 크래시하지 않음', () => {
    /** @type {import('vitest').Mock} */ (track).mockImplementationOnce(() => { throw new Error('network'); });
    expect(() => trackEvent('test_event', {})).not.toThrow();
  });
});
