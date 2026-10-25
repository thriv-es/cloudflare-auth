import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The per-project user tables use snake_case columns, but the User type is
 * camelCase, and the row readers hand back the raw row. Every camelCase
 * property on it therefore reads as undefined, so `/me` answered without
 * `emailVerified` and a confirmed account looked unconfirmed to a client.
 *
 * These tests pin the response the API actually gives.
 */

const { getUserById, getProject, verifyAccessToken } = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getProject: vi.fn(),
  verifyAccessToken: vi.fn(),
}));

vi.mock('../../src/services/user-service', () => ({
  userService: { getUserById, getUserByEmail: vi.fn(), getUserByOAuth: vi.fn(), listUsers: vi.fn() },
}));

vi.mock('../../src/services/project-service', () => ({
  projectService: {
    getProject,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('../../src/services/jwt-service', () => ({
  jwtService: {
    verifyAccessToken,
    extractTokenFromHeader: vi.fn(() => 'mock-token'),
    verifyRefreshToken: vi.fn(),
  },
}));

import app from '../../src/index';
import type { Env } from '../../src/types';

/** A row exactly as D1 returns it: snake_case columns. */
const RAW_ROW = {
  id: 'u1',
  email: 'user@example.com',
  email_verified: 1,
  phone: null,
  phone_verified: 0,
  password_hash: 'hash',
  oauth_provider: null,
  oauth_provider_user_id: null,
  oauth_raw_user_data: null,
  display_name: 'Ada Lovelace',
  avatar_url: null,
  metadata: null,
  status: 'active',
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-02 00:00:00',
  last_login_at: null,
};

const createTestEnv = (): Env =>
  ({
    DB: {
      exec: vi.fn().mockResolvedValue(undefined),
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    },
    ASSETS: {} as any,
    ADMIN_SESSION_SECRET: 'test-session-secret',
    ENCRYPTION_KEY: 'test-encryption-key-32-characters',
  }) as any;

async function getMe() {
  const request = new Request('http://localhost/api/auth/friday/me', {
    headers: { Authorization: 'Bearer mock-token' },
  });
  const response = await app.fetch(request, createTestEnv());
  return { response, body: (await response.json()) as any };
}

describe('GET /api/auth/:projectId/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProject.mockResolvedValue({
      id: 'friday',
      name: 'friday',
      userTableName: 'friday_users',
      jwtSecret: 'secret',
      jwtAlgorithm: 'HS256',
    });
    verifyAccessToken.mockResolvedValue({ sub: 'u1', email: 'user@example.com' });
    getUserById.mockResolvedValue(RAW_ROW);
  });

  it('reports whether the address is confirmed', async () => {
    const { response, body } = await getMe();
    expect(response.status).toBe(200);
    expect(body.data.emailVerified).toBe(true);
  });

  it('reports an unconfirmed address as false', async () => {
    getUserById.mockResolvedValue({ ...RAW_ROW, email_verified: 0 });
    const { body } = await getMe();
    expect(body.data.emailVerified).toBe(false);
  });

  it('reports the display name and the creation date', async () => {
    const { body } = await getMe();
    expect(body.data.displayName).toBe('Ada Lovelace');
    expect(body.data.createdAt).toBe('2026-01-01 00:00:00');
    expect(body.data.status).toBe('active');
  });
});
