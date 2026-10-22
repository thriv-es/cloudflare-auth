import { describe, it, expect, beforeEach, vi } from 'vitest';

const getDefaultProvider = vi.fn();
const getFallbackProvider = vi.fn();
const getTemplate = vi.fn();
const providerSend = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/email-provider-service', () => {
  class EmailProviderService {
    getDefaultProvider = getDefaultProvider;
    getFallbackProvider = getFallbackProvider;
  }
  return { EmailProviderService };
});

vi.mock('../../src/services/email-template-service', () => {
  class EmailTemplateService {
    getTemplate = getTemplate;
  }
  return { EmailTemplateService };
});

vi.mock('../../src/services/email/providers', () => {
  return {
    ProviderFactory: { create: vi.fn(() => ({ send: providerSend })) },
  };
});

import { EmailService } from '../../src/services/email-service';

function createMockEnv(): any {
  return {
    DB: {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    },
    ASSETS: {} as any,
  };
}

const defaultProvider = {
  id: 'p1', provider: 'sendgrid', type: 'api', isDefault: true, isFallback: false,
  config: { apiKey: 'k' }, fromEmail: 'a@b.com', fromName: 'n', enabled: true,
  createdAt: '', updatedAt: '',
} as any;

const projectTemplate = {
  id: 't-project', projectId: 'friday', type: 'password_reset',
  subject: 'Reset your Friday password', bodyHtml: '<p>project</p>', bodyText: 'project',
  createdAt: '', updatedAt: '',
} as any;

const systemTemplate = {
  id: 't-system', projectId: null, type: 'password_reset',
  // Deliberately distinct from projectTemplate's rendered subject, so that a
  // wrong-template regression cannot satisfy both assertions at once.
  subject: 'Reset your {{app_name}} account password', bodyHtml: '<p>system</p>', bodyText: 'system',
  createdAt: '', updatedAt: '',
} as any;

describe('EmailService public methods - projectId param', () => {
  let emailService: EmailService;
  let env: any;

  beforeEach(() => {
    vi.clearAllMocks();
    emailService = new EmailService();
    env = createMockEnv();
    getDefaultProvider.mockResolvedValue(defaultProvider);
    getTemplate.mockResolvedValue({
      id: 't1', projectId: 'ignored', type: 'confirmation',
      subject: 'S', bodyHtml: '<p>X</p>', bodyText: 'X',
      createdAt: '', updatedAt: '',
    });
  });

  it('sendConfirmationEmail forwards the projectId argument', async () => {
    await emailService.sendConfirmationEmail(env, 'u@e.com', 'P', 'https://x', 'pid-1');
    expect(getTemplate.mock.calls[0][0]).toBe('pid-1');
  });

  it('sendPasswordResetEmail forwards the projectId argument', async () => {
    getTemplate.mockResolvedValue({
      id: 't1', projectId: 'ignored', type: 'password_reset',
      subject: 'S', bodyHtml: '<p>X</p>', bodyText: 'X',
      createdAt: '', updatedAt: '',
    });
    await emailService.sendPasswordResetEmail(env, 'u@e.com', 'https://x', 'P', 'pid-2');
    expect(getTemplate.mock.calls[0][0]).toBe('pid-2');
  });

  it('sendWelcomeEmail forwards the projectId argument', async () => {
    getTemplate.mockResolvedValue({
      id: 't1', projectId: 'ignored', type: 'welcome',
      subject: 'S', bodyHtml: '<p>X</p>', bodyText: 'X',
      createdAt: '', updatedAt: '',
    });
    await emailService.sendWelcomeEmail(env, 'u@e.com', 'P', undefined, 'pid-3');
    expect(getTemplate.mock.calls[0][0]).toBe('pid-3');
  });

  it('prefers the project template over the system template', async () => {
    // The project row answers for the project id, the system row for null.
    getTemplate.mockImplementation(async (projectId: string | null, type: string) => {
      if (projectId === 'friday') return projectTemplate;
      return systemTemplate;
    });

    await emailService.sendPasswordResetEmail(env, 'u@e.com', 'https://x', 'Friday', 'friday');

    // The first lookup must be the project one — never the system fallback.
    expect(getTemplate.mock.calls[0][0]).toBe('friday');
    // The system template must not even be consulted once the project one is found.
    expect(getTemplate).toHaveBeenCalledTimes(1);
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(providerSend.mock.calls[0][0]).toMatchObject({
      subject: 'Reset your Friday password',
      html: '<p>project</p>',
    });
  });

  it('falls back to the system template when the project has none', async () => {
    getTemplate.mockImplementation(async (projectId: string | null) =>
      projectId === null ? systemTemplate : null,
    );

    await emailService.sendPasswordResetEmail(env, 'u@e.com', 'https://x', 'Friday', 'friday');

    expect(getTemplate.mock.calls[0][0]).toBe('friday');
    expect(getTemplate.mock.calls[1][0]).toBe(null);
    expect(getTemplate).toHaveBeenCalledTimes(2);
    expect(providerSend.mock.calls[0][0]).toMatchObject({
      subject: 'Reset your Friday account password',
      html: '<p>system</p>',
    });
  });

  it('uses the system template when no project id is given', async () => {
    getTemplate.mockImplementation(async (projectId: string | null) =>
      projectId === null ? systemTemplate : null,
    );

    await emailService.sendPasswordResetEmail(env, 'u@e.com', 'https://x', 'Friday');

    // Only the system template is requested - there is no project to look up.
    expect(getTemplate).toHaveBeenCalledTimes(1);
    expect(getTemplate.mock.calls[0][0]).toBe(null);
    expect(providerSend.mock.calls[0][0]).toMatchObject({
      subject: 'Reset your Friday account password',
      html: '<p>system</p>',
    });
  });
});
