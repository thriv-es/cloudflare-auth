import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The email template that is used for a project's mail must be the project's
 * own template, not the shared system one. The project id has to reach the
 * send call for that to happen — an argument dropped in a merge silently
 * sends every project the system template, so these tests pin the call sites.
 */

const { sendConfirmationEmail, sendPasswordResetEmail, sendWelcomeEmail } = vi.hoisted(() => ({
  sendConfirmationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
}));

vi.mock('../../src/services/email-service', () => ({
  emailService: { sendConfirmationEmail, sendPasswordResetEmail, sendWelcomeEmail },
}));

vi.mock('../../src/services/project-service', () => ({
  projectService: {
    getProject: vi.fn(async () => ({
      id: 'friday',
      name: 'friday',
      siteUrl: 'https://friday.thriv.es',
      userTableName: 'friday_users',
    })),
  },
}));

vi.mock('../../src/services/user-service', () => ({
  userService: {
    getUserByEmail: vi.fn(async () => ({ id: 'u1', email: 'u@example.com' })),
    getUserById: vi.fn(async () => ({ id: 'u1', email: 'u@example.com' })),
  },
}));

vi.mock('../../src/services/password-reset-service', () => ({
  passwordResetService: {
    createResetToken: vi.fn(async () => ({ token: 'reset-token' })),
  },
}));

vi.mock('../../src/services/email-confirmation-service', () => ({
  emailConfirmationService: {
    createConfirmationToken: vi.fn(async () => ({ token: 'confirm-token', tokenId: 't1' })),
    confirmEmail: vi.fn(async () => ({ userId: 'u1', email: 'u@example.com' })),
  },
}));

vi.mock('../../src/services/rate-limit-service', () => ({
  rateLimitService: {
    checkRateLimit: vi.fn(async () => undefined),
    recordAttempt: vi.fn(async () => undefined),
  },
}));

vi.mock('../../src/services/audit-service', () => ({
  auditService: { logEvent: vi.fn(async () => undefined) },
}));

import app from '../../src/index';
import type { Env } from '../../src/types';

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
    ADMIN_DOMAIN: 'admin.example.com',
  }) as any;

async function post(path: string, body: any) {
  const request = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return app.fetch(request, createTestEnv());
}

async function get(path: string) {
  return app.fetch(new Request(`http://localhost${path}`), createTestEnv());
}

describe('Email templates are resolved per project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the password reset mail is sent with the project id', async () => {
    const response = await post('/api/auth/friday/forgot-password', { email: 'u@example.com' });
    expect(response.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    // (env, to, resetUrl, projectName, projectId)
    expect(sendPasswordResetEmail.mock.calls[0][4]).toBe('friday');
  });

  it('the welcome mail is sent with the project id', async () => {
    const response = await get('/api/auth/friday/confirm-email?token=confirm-token');
    expect(response.status).toBe(200);
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    // (env, to, projectName, extraData, projectId)
    expect(sendWelcomeEmail.mock.calls[0][4]).toBe('friday');
  });
});
