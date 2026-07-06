import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Token type isolation tests for one_time_tokens.
 *
 * A confirmation token (token_type='confirmation') must NOT be accepted by
 * the password-reset validator (token_type='recovery') and vice versa.
 * This guards against the historical bug where both flows shared the
 * password_reset_tokens table.
 */

const { rows, setProjectAndUser, mocks } = vi.hoisted(() => {
  const rows: any[] = [];
  const projectServiceMock = { getProject: vi.fn() };
  const userServiceMock = { getUserById: vi.fn(), updateUser: vi.fn() };
  const auditServiceMock = { logEvent: vi.fn() };

  function setProjectAndUser() {
    projectServiceMock.getProject.mockResolvedValue({
      id: 'proj-1', name: 'Test', userTableName: 'users_proj_1',
    });
    userServiceMock.getUserById.mockResolvedValue({
      id: 'user-1', email: 'u@e.com',
    });
  }

  return {
    rows,
    setProjectAndUser,
    mocks: { projectServiceMock, userServiceMock, auditServiceMock },
  };
});

function makeQueryBuilder() {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    values: vi.fn((v: any) => {
      const inserted = { id: `id-${rows.length + 1}`, ...v };
      rows.push(inserted);
      return { returning: vi.fn().mockResolvedValue([{ id: inserted.id }]) };
    }),
    set: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(async () => rows.slice()),
    get: vi.fn().mockImplementation(async () => rows[rows.length - 1] ?? null),
  };
}

vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => makeQueryBuilder()),
}));

vi.mock('../../src/services/project-service', () => ({
  projectService: mocks.projectServiceMock,
}));
vi.mock('../../src/services/user-service', () => ({
  userService: mocks.userServiceMock,
}));
vi.mock('../../src/services/audit-service', () => ({
  auditService: mocks.auditServiceMock,
}));
vi.mock('../../src/utils/crypto', () => ({
  hashToken: vi.fn(async (t: string) => `h:${t}`),
  hashPassword: vi.fn(async (t: string) => `hp:${t}`),
}));

import { emailConfirmationService } from '../../src/services/email-confirmation-service';
import { passwordResetService } from '../../src/services/password-reset-service';

const env: any = { DB: {} };

describe('one_time_tokens - type isolation', () => {
  beforeEach(() => {
    rows.length = 0;
    vi.clearAllMocks();
  });

  it('confirmation token is rejected by the password reset validator', async () => {
    setProjectAndUser();
    const { token } = await emailConfirmationService.createConfirmationToken(
      env, 'proj-1', 'user-1', 'u@e.com'
    );
    expect(token).toBeTruthy();

    // simulate "no recovery token stored"
    rows.length = 0;

    await expect(
      passwordResetService.validateResetToken(env, 'proj-1', token)
    ).rejects.toThrow(/Invalid reset token/);
  });

  it('password reset token is rejected by the confirmation validator', async () => {
    setProjectAndUser();
    const { token } = await passwordResetService.createResetToken(
      env, 'proj-1', 'user-1', 'u@e.com'
    );

    rows.length = 0;

    await expect(
      emailConfirmationService.validateConfirmationToken(env, 'proj-1', token)
    ).rejects.toThrow(/Invalid confirmation token/);
  });

  it('a valid confirmation token validates against its own flow', async () => {
    setProjectAndUser();
    const { token } = await emailConfirmationService.createConfirmationToken(
      env, 'proj-1', 'user-1', 'u@e.com'
    );
    const validated = await emailConfirmationService.validateConfirmationToken(
      env, 'proj-1', token
    );
    expect(validated.email).toBe('u@e.com');
    expect(validated.userId).toBe('user-1');
  });

  it('a valid recovery token validates against its own flow', async () => {
    setProjectAndUser();
    const { token } = await passwordResetService.createResetToken(
      env, 'proj-1', 'user-1', 'u@e.com'
    );
    const validated = await passwordResetService.validateResetToken(
      env, 'proj-1', token
    );
    expect(validated.email).toBe('u@e.com');
    expect(validated.userId).toBe('user-1');
  });
});
