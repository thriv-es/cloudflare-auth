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
});
