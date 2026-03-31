'use strict';

const {
  makeToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireCreator,
  requireAdmin,
} = require('../../lib/auth');

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

// Helper to create mock Express req/res/next
function mockReqResNext(overrides = {}) {
  const req = {
    headers: {},
    query: {},
    body: {},
    ...overrides,
  };
  const res = {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

// ── makeToken / verifyToken ───────────────────────────────
describe('makeToken + verifyToken', () => {
  const user = { id: 'usr_123', email: 'test@example.com', slug: 'test-community' };

  test('creates a valid JWT that can be verified', () => {
    const token = makeToken(user, TEST_SECRET);
    expect(typeof token).toBe('string');

    const payload = verifyToken(token, TEST_SECRET);
    expect(payload.id).toBe('usr_123');
    expect(payload.email).toBe('test@example.com');
    expect(payload.slug).toBe('test-community');
    expect(payload.is_creator).toBe(true);
  });

  test('token has correct expiry', () => {
    const token = makeToken(user, TEST_SECRET, '1h');
    const payload = verifyToken(token, TEST_SECRET);
    const expiresIn = payload.exp - payload.iat;
    expect(expiresIn).toBe(3600); // 1 hour
  });

  test('verify throws on wrong secret', () => {
    const token = makeToken(user, TEST_SECRET);
    expect(() => verifyToken(token, 'wrong-secret')).toThrow();
  });

  test('verify throws on tampered token', () => {
    const token = makeToken(user, TEST_SECRET);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyToken(tampered, TEST_SECRET)).toThrow();
  });
});

// ── requireAuth middleware ─────────────────────────────────
describe('requireAuth', () => {
  const middleware = requireAuth(TEST_SECRET);
  const user = { id: 'usr_456', email: 'a@b.com', slug: 'slug' };

  test('passes with valid token and sets req.userId', () => {
    const token = makeToken(user, TEST_SECRET);
    const { req, res, next } = mockReqResNext({
      headers: { authorization: `Bearer ${token}` },
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('usr_456');
    expect(req.user.id).toBe('usr_456');
  });

  test('returns 401 when no token provided', () => {
    const { req, res, next } = mockReqResNext();
    middleware(req, res, next);
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Auth required');
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 for invalid token', () => {
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    middleware(req, res, next);
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Invalid token');
    expect(next).not.toHaveBeenCalled();
  });
});

// ── optionalAuth middleware ────────────────────────────────
describe('optionalAuth', () => {
  const middleware = optionalAuth(TEST_SECRET);
  const user = { id: 'usr_789', email: 'c@d.com', slug: 'slug' };

  test('sets userId when valid token present', () => {
    const token = makeToken(user, TEST_SECRET);
    const { req, res, next } = mockReqResNext({
      headers: { authorization: `Bearer ${token}` },
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('usr_789');
  });

  test('proceeds without error when no token present', () => {
    const { req, res, next } = mockReqResNext();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });

  test('proceeds without error when token is invalid', () => {
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer garbage' },
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });
});

// ── requireCreator middleware ──────────────────────────────
describe('requireCreator', () => {
  const middleware = requireCreator(TEST_SECRET);
  const user = { id: 'cr_1', email: 'creator@test.com', slug: 'my-community' };

  test('passes with valid token and sets req.creator', () => {
    const token = makeToken(user, TEST_SECRET);
    const { req, res, next } = mockReqResNext({
      headers: { authorization: `Bearer ${token}` },
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.creator.id).toBe('cr_1');
    expect(req.creator.slug).toBe('my-community');
  });

  test('returns 401 with no token', () => {
    const { req, res, next } = mockReqResNext();
    middleware(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── requireAdmin middleware ────────────────────────────────
describe('requireAdmin', () => {
  test('returns 503 when admin secret not configured', () => {
    const middleware = requireAdmin(undefined);
    const { req, res, next } = mockReqResNext();
    middleware(req, res, next);
    expect(res._status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('passes when secret matches via query param', () => {
    const middleware = requireAdmin('my-admin-secret');
    const { req, res, next } = mockReqResNext({
      query: { secret: 'my-admin-secret' },
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('passes when secret matches via Authorization header', () => {
    const middleware = requireAdmin('my-admin-secret');
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer my-admin-secret' },
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('passes when secret matches via body', () => {
    const middleware = requireAdmin('my-admin-secret');
    const { req, res, next } = mockReqResNext({
      body: { secret: 'my-admin-secret' },
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 403 when secret does not match', () => {
    const middleware = requireAdmin('my-admin-secret');
    const { req, res, next } = mockReqResNext({
      query: { secret: 'wrong-secret' },
    });
    middleware(req, res, next);
    expect(res._status).toBe(403);
    expect(res._json.error).toBe('Forbidden');
    expect(next).not.toHaveBeenCalled();
  });
});
