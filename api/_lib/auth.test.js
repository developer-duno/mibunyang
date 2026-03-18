// @vitest-environment node
/**
 * auth.js 테스트 — hashPassword, verifyPassword (PBKDF2 + 레거시 SHA-256), createToken, verifyToken
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// AUTH_SECRET 환경변수 설정
beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-auth';
});

// 동적 import로 모듈 로드 (환경변수 설정 후)
const { hashPassword, verifyPassword, createToken, verifyToken } = await import('./auth.js');

describe('hashPassword', () => {
  // 정상: 새 salt 생성하여 해시
  it('새 salt로 PBKDF2 해시를 생성한다', () => {
    const { hash, salt } = hashPassword('mypassword');
    expect(hash).toBeTruthy();
    expect(salt).toBeTruthy();
    // PBKDF2-SHA512는 128자 hex (64바이트)
    expect(hash).toHaveLength(128);
    // salt는 64자 hex (32바이트)
    expect(salt).toHaveLength(64);
  });

  // 정상: 기존 salt 사용 시 동일 해시 반환
  it('동일 salt와 패스워드로 동일 해시를 반환한다', () => {
    const { hash: h1, salt } = hashPassword('test123');
    const { hash: h2 } = hashPassword('test123', salt);
    expect(h1).toBe(h2);
  });

  // 에러: 다른 패스워드는 다른 해시
  it('다른 패스워드는 다른 해시를 생성한다', () => {
    const { hash: h1, salt } = hashPassword('password1');
    const { hash: h2 } = hashPassword('password2', salt);
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  // 정상: PBKDF2 해시 검증 성공
  it('PBKDF2 해시를 정상 검증한다 (128자 해시)', () => {
    const { hash, salt } = hashPassword('correctpassword');
    expect(verifyPassword('correctpassword', hash, salt)).toBe(true);
  });

  // 에러: 잘못된 패스워드
  it('잘못된 패스워드로 검증 실패한다', () => {
    const { hash, salt } = hashPassword('correctpassword');
    expect(verifyPassword('wrongpassword', hash, salt)).toBe(false);
  });

  // 정상: 레거시 SHA-256 해시 검증 (64자)
  it('레거시 SHA-256 해시를 검증한다 (64자)', () => {
    const salt = 'legacy-salt';
    const password = 'legacypass';
    // SHA-256: crypto.createHash("sha256").update(salt + password).digest("hex")
    const legacyHash = crypto.createHash('sha256').update(salt + password).digest('hex');
    expect(legacyHash).toHaveLength(64);
    expect(verifyPassword(password, legacyHash, salt)).toBe(true);
  });

  // 에러: 레거시 SHA-256에서 잘못된 패스워드
  it('레거시 SHA-256에서 잘못된 패스워드로 실패한다', () => {
    const salt = 'legacy-salt';
    const legacyHash = crypto.createHash('sha256').update(salt + 'correct').digest('hex');
    expect(verifyPassword('wrong', legacyHash, salt)).toBe(false);
  });
});

describe('createToken', () => {
  // 정상: JWT 형태 토큰 생성
  it('3-part JWT 형태 토큰을 생성한다', () => {
    const token = createToken({ email: 'test@test.com', name: 'Test' });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  // 정상: payload에 iat, exp 포함
  it('payload에 iat, exp가 포함된다', () => {
    const token = createToken({ email: 'a@b.com' });
    const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(body.iat).toBeDefined();
    expect(body.exp).toBeDefined();
    expect(body.email).toBe('a@b.com');
  });

  // 정상: 커스텀 TTL 적용
  it('커스텀 TTL이 적용된다', () => {
    const token = createToken({ email: 'a@b.com' }, { ttl: 3600000 });
    const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(body.exp - body.iat).toBe(3600000);
  });

  // 에러: AUTH_SECRET 없으면 에러
  it('AUTH_SECRET 미설정 시 에러를 던진다', () => {
    delete process.env.AUTH_SECRET;
    expect(() => createToken({ email: 'a@b.com' })).toThrow('AUTH_SECRET');
    process.env.AUTH_SECRET = 'test-secret-key-for-auth';
  });
});

describe('verifyToken', () => {
  // 정상: 유효한 토큰 검증
  it('유효한 토큰을 검증하고 payload를 반환한다', () => {
    const token = createToken({ email: 'user@test.com', role: 'admin' });
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload.email).toBe('user@test.com');
    expect(payload.role).toBe('admin');
  });

  // 에러: 만료된 토큰
  it('만료된 토큰은 null을 반환한다', () => {
    // TTL을 -1로 설정하여 즉시 만료
    const token = createToken({ email: 'a@b.com' }, { ttl: -1 });
    const payload = verifyToken(token);
    expect(payload).toBeNull();
  });

  // 에러: 변조된 토큰
  it('변조된 토큰은 null을 반환한다', () => {
    const token = createToken({ email: 'a@b.com' });
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(verifyToken(tampered)).toBeNull();
  });

  // 에러: 잘못된 형식 토큰
  it('형식이 잘못된 토큰은 null을 반환한다', () => {
    expect(verifyToken('not-a-token')).toBeNull();
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('a.b')).toBeNull();
  });

  // 에러: null/undefined 입력
  it('null 입력 시 null을 반환한다', () => {
    expect(verifyToken(null)).toBeNull();
    expect(verifyToken(undefined)).toBeNull();
  });
});
