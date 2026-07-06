import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CloudflareEmailProvider } from '../../src/services/email/providers';

const mockMessage = {
  to: 'recipient@example.com',
  from: 'welcome@yourdomain.com',
  subject: 'Welcome!',
  html: '<h1>Welcome!</h1>',
  text: 'Welcome!',
};

describe('CloudflareEmailProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('send', () => {
    it('should send email successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            delivered: ['recipient@example.com'],
            permanent_bounces: [],
            queued: [],
          },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = new CloudflareEmailProvider({
        accountId: 'test-account-id',
        apiToken: 'test-api-token',
      });

      await expect(provider.send(mockMessage)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/test-account-id/email/sending/send');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-api-token');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.to).toBe('recipient@example.com');
      expect(body.from).toEqual({ address: 'welcome@yourdomain.com', name: undefined });
      expect(body.subject).toBe('Welcome!');
      expect(body.html).toBe('<h1>Welcome!</h1>');
      expect(body.text).toBe('Welcome!');
    });

    it('should send `from` as an object with address and name when fromName is present', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, errors: [], result: { delivered: [], permanent_bounces: [], queued: [] } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = new CloudflareEmailProvider({ accountId: 'acct', apiToken: 'tok' });
      await provider.send({ ...mockMessage, fromName: 'My App' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.from).toEqual({ address: 'welcome@yourdomain.com', name: 'My App' });
    });

    it('should throw when HTTP response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({
          success: false,
          errors: [{ code: 400, message: 'Invalid recipient address' }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = new CloudflareEmailProvider({ accountId: 'acct', apiToken: 'tok' });
      await expect(provider.send(mockMessage)).rejects.toThrow('Cloudflare Email Error: Invalid recipient address');
    });

    it('should fall back to statusText when error response has no message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = new CloudflareEmailProvider({ accountId: 'acct', apiToken: 'tok' });
      await expect(provider.send(mockMessage)).rejects.toThrow('Cloudflare Email Error: Unauthorized');
    });

    it('should throw when API returns success=false with ok HTTP status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          errors: [{ code: 10001, message: 'Unable to authenticate request' }],
          result: null,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = new CloudflareEmailProvider({ accountId: 'acct', apiToken: 'bad-token' });
      await expect(provider.send(mockMessage)).rejects.toThrow('Cloudflare Email Error: Unable to authenticate request');
    });

    it('should throw with fallback message when success=false and no error details', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, errors: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = new CloudflareEmailProvider({ accountId: 'acct', apiToken: 'tok' });
      await expect(provider.send(mockMessage)).rejects.toThrow('Cloudflare Email Error: Unknown error');
    });

    it('should throw when accountId is missing', async () => {
      const provider = new CloudflareEmailProvider({ accountId: undefined, apiToken: 'tok' });
      await expect(provider.send(mockMessage)).rejects.toThrow('Cloudflare Email: accountId is required');
    });

    it('should throw when apiToken is missing', async () => {
      const provider = new CloudflareEmailProvider({ accountId: 'acct', apiToken: undefined });
      await expect(provider.send(mockMessage)).rejects.toThrow('Cloudflare Email: apiToken is required');
    });
  });
});
