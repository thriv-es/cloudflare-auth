import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CloudflareBindingProvider } from '../../src/services/email/providers';

const baseMsg = {
  to: 'recipient@example.com',
  from: 'welcome@yourdomain.com',
  fromName: 'My App',
  subject: 'Welcome!',
  html: '<h1>Welcome!</h1>',
  text: 'Welcome!',
};

function makeMockBinding() {
  return { send: vi.fn().mockResolvedValue({ success: true }) };
}

describe('CloudflareBindingProvider', () => {
  let binding: ReturnType<typeof makeMockBinding>;
  let provider: CloudflareBindingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    binding = makeMockBinding();
    provider = new CloudflareBindingProvider({ binding: binding as any });
  });

  describe('send', () => {
    it('calls env.EMAIL.send with the correct payload shape', async () => {
      await provider.send(baseMsg);
      expect(binding.send).toHaveBeenCalledOnce();
      const arg = binding.send.mock.calls[0][0];
      expect(arg).toEqual({
        from: { email: 'welcome@yourdomain.com', name: 'My App' },
        to: 'recipient@example.com',
        subject: 'Welcome!',
        html: '<h1>Welcome!</h1>',
        text: 'Welcome!',
      });
    });

    it('always sends both html and text bodies', async () => {
      await provider.send({ ...baseMsg, text: undefined });
      const arg = binding.send.mock.calls[0][0];
      expect(arg.html).toBeTruthy();
      expect(typeof arg.text).toBe('string');
      expect(arg.text.length).toBeGreaterThan(0);
    });

    it('omits the name field when fromName is missing', async () => {
      await provider.send({ ...baseMsg, fromName: undefined });
      const arg = binding.send.mock.calls[0][0];
      expect(arg.from).toEqual({ email: 'welcome@yourdomain.com' });
    });
  });

  describe('error code mapping', () => {
    it('throws a typed error for E_SENDER_NOT_VERIFIED', async () => {
      binding.send.mockRejectedValue({ message: 'E_SENDER_NOT_VERIFIED: domain not onboarded' });
      await expect(provider.send(baseMsg)).rejects.toThrow(/sender not verified/i);
    });

    it('throws a typed error for E_RECIPIENT_SUPPRESSED', async () => {
      binding.send.mockRejectedValue({ message: 'E_RECIPIENT_SUPPRESSED: address on suppression list' });
      await expect(provider.send(baseMsg)).rejects.toThrow(/recipient suppressed/i);
    });

    it('throws a retryable error for E_RATE_LIMIT_EXCEEDED', async () => {
      binding.send.mockRejectedValue({ message: 'E_RATE_LIMIT_EXCEEDED' });
      await expect(provider.send(baseMsg)).rejects.toThrow(/rate limit/i);
    });

    it('throws a retryable error for E_DAILY_LIMIT_EXCEEDED', async () => {
      binding.send.mockRejectedValue({ message: 'E_DAILY_LIMIT_EXCEEDED' });
      await expect(provider.send(baseMsg)).rejects.toThrow('Cloudflare Email: daily sending limit exceeded');
    });

    it('throws a validation error for E_VALIDATION_ERROR', async () => {
      binding.send.mockRejectedValue({ message: 'E_VALIDATION_ERROR: bad payload' });
      await expect(provider.send(baseMsg)).rejects.toThrow(/validation/i);
    });

    it('rethrows unknown errors with their original message', async () => {
      binding.send.mockRejectedValue(new Error('mystery'));
      await expect(provider.send(baseMsg)).rejects.toThrow('mystery');
    });
  });
});
