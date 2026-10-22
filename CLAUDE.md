# CLAUDE.md - Development Guidelines

## Project Overview

This is a Cloudflare Workers-based authentication service with multi-project support. It provides user authentication, OAuth integration (Google, GitHub, Microsoft), email services (SendGrid), and admin dashboard.

## TDD (Test-Driven Development) Workflow

All new features and bug fixes MUST follow this workflow:

1. **Write the test first** - Create a failing test that describes the expected behavior
2. **Run the test** - Verify it fails
3. **Implement the feature** - Write the minimum code to make the test pass
4. **Refactor** - Improve code while keeping tests passing
5. **Commit** - Only after tests pass

### Before Adding Any Feature

- Create unit tests in `test/` directory matching the source file structure
- Tests MUST exist BEFORE any implementation changes
- Run `npm test` to verify tests pass
- Target 100% test coverage

## Testing Standards

### Test File Organization

```
test/
├── services/
│   ├── auth-service.test.ts
│   ├── oauth-service.test.ts
│   ├── email-service.test.ts
│   └── ...
├── utils/
│   ├── helpers.test.ts
│   ├── validation.test.ts
│   ├── errors.test.ts
│   └── crypto.test.ts
└── e2e/
    └── ...
```

### Test Structure

Each test file should follow this pattern:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceName } from '../../src/services/service-name';

describe('ServiceName', () => {
  let service: ServiceName;
  let mockEnv: Env;

  beforeEach(() => {
    service = new ServiceName();
    mockEnv = createMockEnv();
    vi.clearAllMocks();
  });

  describe('methodName', () => {
    it('should do something specific', async () => {
      // Arrange
      const input = 'test-input';
      
      // Act
      const result = await service.methodName(input, mockEnv);
      
      // Assert
      expect(result).toBe('expected-output');
    });

    it('should handle error case', async () => {
      // Arrange
      const input = 'invalid';
      
      // Act & Assert
      await expect(service.methodName(input, mockEnv))
        .rejects.toThrow(ErrorType);
    });
  });
});
```

### Mocking Guidelines

- Use `vi.fn()` for mocking functions
- Mock external dependencies (D1, external APIs)
- Use `createMockEnv()` helper for consistent environment mocking

- **Do not let slow crypto run at production cost.** `hashPassword` uses bcrypt
  cost 12 (~500ms per hash in pure-JS bcryptjs). Tests that need a hash should
  mock `bcryptjs` with a capped work factor (see `test/utils/crypto.test.ts`)
  rather than paying production cost on every run.

### Test Coverage Requirements

- All exported functions MUST have tests
- All edge cases MUST be covered
- Error handling MUST be tested
- Integration points (OAuth, email providers) SHOULD be mocked

## Running Tests

`npm test` runs the suite **once and exits** — it is CI-safe and never hangs.
Watch mode is a separate script, because vitest's `--watch` flag overrides the
`run` subcommand and would leave the process alive forever.

```bash
# Run all tests once, then exit
npm test

# Re-run on file changes (watch mode - never exits, press q to quit)
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- test/utils/helpers.test.ts
```

Do **not** use `npm test -- --watch`: vitest starts watching instead of running
once, so the command appears to hang after the suite passes.

## CI/CD Requirements

All tests MUST pass before code can be merged. This includes:
- Unit tests pass
- Coverage meets or exceeds current levels
- No TypeScript errors (`npm run type-check`)

## Integration Testing

For external integrations (Google OAuth, SendGrid, etc.), use mocks in unit tests. End-to-end tests can use test credentials stored in environment variables.

## OAuth `redirect_uri` contract

**Do not "fix" the OAuth redirect handling to use a server-side configured URI.** The
`redirect_uri` is deliberately **client-supplied** and is threaded verbatim through *both*
Google requests:

1. `GET /api/auth/:projectId/oauth/:provider?redirect_uri=...` → embedded in the Google
   **authorization** request.
2. `GET /api/auth/:projectId/oauth/:provider/callback?code=...&redirect_uri=...` → forwarded to
   the Google **token** endpoint.

Google requires the value to be byte-for-byte identical in both steps, and to exactly match an
entry in the provider console's *Authorized redirect URIs* (no wildcards, no prefix matching).

The registered URI is the **frontend application's** callback URL (e.g.
`https://app.example.com/auth/google/callback`) — **not** this service's
`/api/auth/:projectId/oauth/:provider/callback` endpoint, which returns JSON rather than
redirecting the browser. This keeps the auth service's own URL out of every tenant's provider
console, and lets each tenant point at its own frontend.

Provider credentials are stored **per project** (`project_oauth_providers`, unique on
`project_id` + `provider_name`), so each tenant can use its own Google OAuth client.

Full setup guide, matching rules and troubleshooting:
https://github.com/evilUrge/cloudflare-auth/wiki/Google-OAuth

Known gaps in the current implementation (all documented in the wiki): `state` is never
validated server-side, `redirect_uri` is not validated against an allowlist, `refreshToken`
is a literal placeholder, and OAuth accounts cannot be linked to existing password accounts.
