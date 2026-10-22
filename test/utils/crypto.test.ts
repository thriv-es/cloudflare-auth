import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bcryptjs is pure JS, so the production work factor (12 rounds) costs
 * ~500ms per hash here. That made this file alone account for ~90% of the
 * whole suite's runtime while asserting nothing about the work factor.
 * We keep the real bcrypt implementation — real hash format, real compare
 * semantics — and only cap the number of rounds so the tests stay fast.
 */
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcryptjs')>();
  const TEST_ROUNDS = 4; // bcrypt's minimum; ~12ms per hash
  return {
    ...actual,
    hash: (password: string, salt: number | string) =>
      actual.hash(
        password,
        typeof salt === 'number' ? Math.min(salt, TEST_ROUNDS) : TEST_ROUNDS
      ),
  };
});
import {
  generateJWTSecret,
  generateSessionToken,
  generateRefreshToken,
  hashPassword,
  verifyPassword,
  hashToken,
  encrypt,
  decrypt,
  generateId,
} from '../../src/utils/crypto';

describe('Crypto Utils', () => {
  describe('generateJWTSecret', () => {
    it('should generate a base64 encoded secret', () => {
      const secret = generateJWTSecret();
      
      expect(secret).toBeTruthy();
      expect(typeof secret).toBe('string');
      // Base64 encoded
      expect(() => atob(secret)).not.toThrow();
    });

    it('should generate different secrets', () => {
      const secret1 = generateJWTSecret();
      const secret2 = generateJWTSecret();
      
      expect(secret1).not.toBe(secret2);
    });

    it('should generate 256-bit secret', () => {
      const secret = generateJWTSecret();
      const decoded = atob(secret);
      
      expect(decoded.length).toBe(32);
    });
  });

  describe('generateSessionToken', () => {
    it('should generate a token with default length', () => {
      const token = generateSessionToken();
      
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    it('should generate different tokens', () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      
      expect(token1).not.toBe(token2);
    });

    it('should generate long token', () => {
      const token = generateSessionToken();
      
      expect(token.length).toBeGreaterThanOrEqual(64);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a token', () => {
      const token = generateRefreshToken();
      
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    it('should generate different tokens', () => {
      const token1 = generateRefreshToken();
      const token2 = generateRefreshToken();
      
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const hash = await hashPassword('TestPassword123');
      
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe('TestPassword123');
    });

    it('should generate different hashes for same password', async () => {
      const hash1 = await hashPassword('TestPassword123');
      const hash2 = await hashPassword('TestPassword123');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate bcrypt hash', async () => {
      const hash = await hashPassword('TestPassword123');
      
      expect(hash.startsWith('$2')).toBe(true);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'TestPassword123';
      const hash = await hashPassword(password);
      
      const isValid = await verifyPassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await hashPassword('TestPassword123');
      
      const isValid = await verifyPassword('WrongPassword', hash);
      
      expect(isValid).toBe(false);
    });

    it('should handle empty password', async () => {
      const hash = await hashPassword('TestPassword123');
      
      const isValid = await verifyPassword('', hash);
      
      expect(isValid).toBe(false);
    });
  });

  describe('hashToken', () => {
    it('should hash a token', async () => {
      const hash = await hashToken('test-token');
      
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate SHA-256 hash (64 chars)', async () => {
      const hash = await hashToken('test-token');
      
      expect(hash.length).toBe(64);
    });

    it('should generate consistent hashes', async () => {
      const hash1 = await hashToken('test-token');
      const hash2 = await hashToken('test-token');
      
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different tokens', async () => {
      const hash1 = await hashToken('token1');
      const hash2 = await hashToken('token2');
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('encrypt/decrypt', () => {
    const testKey = 'test-encryption-key-32-chars!!';

    it('should encrypt text', async () => {
      const encrypted = await encrypt('Hello World', testKey);
      
      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe('Hello World');
    });

    it('should decrypt encrypted text', async () => {
      const encrypted = await encrypt('Hello World', testKey);
      const decrypted = await decrypt(encrypted, testKey);
      
      expect(decrypted).toBe('Hello World');
    });

    it('should produce different ciphertext for same plaintext', async () => {
      const encrypted1 = await encrypt('Hello World', testKey);
      const encrypted2 = await encrypt('Hello World', testKey);
      
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle empty string', async () => {
      const encrypted = await encrypt('', testKey);
      const decrypted = await decrypt(encrypted, testKey);
      
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', async () => {
      const encrypted = await encrypt('你好世界', testKey);
      const decrypted = await decrypt(encrypted, testKey);
      
      expect(decrypted).toBe('你好世界');
    });

    it('should handle special characters', async () => {
      const original = '!@#$%^&*(){}[]|\\;:\'",<>?/';
      const encrypted = await encrypt(original, testKey);
      const decrypted = await decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(original);
    });

    it('should fail decrypt with wrong key', async () => {
      const encrypted = await encrypt('Hello World', testKey);
      
      await expect(
        decrypt(encrypted, 'wrong-key-32-chars-!!!!!')
      ).rejects.toThrow();
    });

    it('should pad short keys to 32 chars', async () => {
      const shortKey = 'short';
      const encrypted = await encrypt('Hello World', shortKey);
      const decrypted = await decrypt(encrypted, shortKey);
      
      expect(decrypted).toBe('Hello World');
    });
  });

  describe('generateId', () => {
    it('should generate a unique ID', () => {
      const id = generateId();
      
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should generate different IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      expect(id1).not.toBe(id2);
    });

    it('should generate URL-safe ID', () => {
      const id = generateId();
      
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    });
  });
});