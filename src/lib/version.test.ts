import { describe, it, expect } from 'vitest';
import { TS_BOOTSTRAP_MILESTONE, getTsBootstrapVersion } from './version';

describe('TS bootstrap version', () => {
  it('TS_BOOTSTRAP_MILESTONE 은 "M0" 리터럴 타입', () => {
    expect(TS_BOOTSTRAP_MILESTONE).toBe('M0');
  });

  it('getTsBootstrapVersion 은 milestone 포함 문자열 반환', () => {
    const version = getTsBootstrapVersion();
    expect(version).toContain('M0');
    expect(version).toContain('mibunyang');
  });
});
