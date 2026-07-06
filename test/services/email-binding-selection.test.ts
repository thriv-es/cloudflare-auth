import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for the zero-config provider selection:
 *   - when env.EMAIL binding is present and no provider rows exist, the
 *     service falls back to the binding.
 *   - when a default provider row exists, it wins over the binding.
 *   - when only the binding is present, it is used even without rows.
 */

const { bindingSend, defaultProviderGet, fallbackProviderGet } = vi.hoisted(() => ({
  bindingSend: vi.fn().mockResolvedValue({ success: true }),
  defaultProviderGet: vi.fn(),
  fallbackProviderGet: vi.fn(),
}));

function makeMockEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    },
    ASSETS: {} as any,
    EMAIL: { send: bindingSend } as any,
  };
}

vi.mock('../../src/services/email-provider-service', () => {
  return {
    EmailProviderService: class {
      getDefaultProvider = defaultProviderGet;
      getFallbackProvider = fallbackProviderGet;
    },
  };
});

vi.mock('../../src/services/email-template-service', () => {
  return {
    EmailTemplateService: class {
      getTemplate = vi.fn().mockResolvedValue({
        id: 't1', projectId: null, type: 'welcome',
        subject: 'Hi', bodyHtml: '<p>X</p>', bodyText: 'X',
        createdAt: '', updatedAt: '',
      });
    },
  };
});

vi.mock('../../src/services/email/providers', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn((type: string, _cfg: any) => {
    if (type === 'cloudflare_binding') {
      return { send };
    }
    return { send: vi.fn().mockResolvedValue(undefined) };
  });
  return { ProviderFactory: { create }, __bindingSend: send };
});

import { EmailService } from '../../src/services/email-service';

describe('EmailService provider selection - zero-config binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProviderGet.mockResolvedValue(null);
    fallbackProviderGet.mockResolvedValue(null);
  });

  it('uses the binding when no provider rows exist and EMAIL is present', async () => {
    const env = makeMockEnv();
    const svc = new EmailService();
    await svc.sendConfirmationEmail(env, 'u@e.com', 'P', 'https://x', 'proj-1');

    const { ProviderFactory } = await import('../../src/services/email/providers');
    const { __bindingSend } = await import('../../src/services/email/providers');
    expect(ProviderFactory.create).toHaveBeenCalledWith('cloudflare_binding', expect.anything());
    expect(__bindingSend).toHaveBeenCalled();
  });

  it('uses the configured default provider when one exists, ignoring the binding', async () => {
    defaultProviderGet.mockResolvedValue({
      id: 'p1', provider: 'sendgrid', type: 'api', isDefault: true, isFallback: false,
      config: { apiKey: 'k' }, fromEmail: 'a@b.com', fromName: 'n', enabled: true,
      createdAt: '', updatedAt: '',
    });
    const env = makeMockEnv();
    const svc = new EmailService();
    await svc.sendConfirmationEmail(env, 'u@e.com', 'P', 'https://x', 'proj-1');

    const { ProviderFactory } = await import('../../src/services/email/providers');
    expect(ProviderFactory.create).toHaveBeenCalledWith('sendgrid', expect.anything());
  });
});
