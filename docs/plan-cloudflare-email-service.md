# Plan: Cloudflare Email Service and Auth Email Parity

## Plan status

Overall status: todo

| Phase | Title | Status |
| ----- | ----------------------------------- | ------ |
| 0 | Fixes and groundwork | todo |
| 1 | Native Cloudflare Email binding | todo |
| 2 | Auth email flow parity | todo |
| 3 | Template upgrade and admin UI | todo |
| 4 | One-click deploy integration | todo |
| 5 | Observability and operations | todo |

The implementing agent must update each phase status
(todo, doing, done) as work progresses.

Release plan (decided 2026-07-05): release 1 ships phases 0
and 1; release 2 ships phases 2 through 5.

## Scope summary

Make Cloudflare Email Service the built-in, zero-config email
provider for this auth service, and close the gap with the email
flows that Supabase Auth and Auth0 provide: signup confirmation,
welcome, password reset, magic link, one-time code (OTP), email
change, and user invitation. Ship polished default templates with
embedded action links for every flow, and keep the one-click
"Deploy to Cloudflare" button working so a fresh deployment gets
email sending with minimal manual steps.

## Current state

A scan of the repo shows the email foundation already exists. This
plan builds on it rather than replacing it.

Already implemented:

- Provider abstraction with six senders (SendGrid, Postmark,
  Mailgun, Resend, Cloudflare REST, SMTP) in
  `src/services/email/providers.ts`.
- A Cloudflare sender that calls the REST endpoint
  `accounts/{id}/email/sending/send` using `CF_ACCOUNT_ID` and
  `CF_API_TOKEN` secrets (`wrangler.toml` documents both).
- DB-backed templates with system and per-project scope in
  `src/services/email-template-service.ts`. The schema already
  defines six types: welcome, confirmation, password_reset,
  magic_link, email_change, otp.
- Working flows: registration confirmation, password reset,
  welcome email, admin resend-verification.
- Admin API routes for managing providers and templates.
- Multi-project model with `siteUrl` and `redirectUrls` columns.
- A "Deploy to Cloudflare Workers" button in the README.

Defects found during the scan (fixed in Phase 0):

- All four email call sites in `src/index.ts` (lines 538, 839,
  991, 1113) omit the trailing `projectId` argument, so
  per-project templates are never used. Every project gets the
  system template.
- The Cloudflare REST sender sends `from` as a display string.
  The REST API expects an object of the shape
  `{ "address": "...", "name": "..." }`, so sends with a
  `fromName` are likely rejected or mis-parsed.
- Email confirmation tokens reuse `password_reset_tokens` with no
  type column. A confirmation token could be replayed against the
  reset endpoint for the same user, and new flows (magic link,
  OTP, invite) have no clean place to store tokens.
- Default templates are one-line placeholders, far below the
  quality of Supabase or Auth0 defaults.
- The `redirectUrls` allowlist exists in the schema but no
  endpoint accepts or validates a `redirect_to` parameter.

One naming note: this service is a custom Hono application, not
Auth.js. Nothing in the plan depends on Auth.js.

## Competitor parity matrix

| Flow | Supabase | Auth0 | Repo today | Phase |
| ---------------- | -------- | ----- | ------------- | ----- |
| Confirm signup | yes | yes | partial | 0, 2 |
| Welcome | via hook | yes | yes | 3 |
| Password reset | yes | yes | yes | 3 |
| Magic link login | yes | yes | template only | 2 |
| Email OTP login | yes | yes | template only | 2 |
| Change email | yes | yes | template only | 2 |
| Invite user | yes | yes | no | later |
| Reauthentication | yes | no | no | later |
| Template editor | yes | yes | basic | 3 |
| Redirect allowlist | yes | yes | schema only | 2 |

Two flows are intentionally deferred (decided 2026-07-05).
Reauthentication (Supabase sends an OTP before sensitive
actions) reuses the OTP machinery from Phase 2 and can be added
afterward without schema changes. The admin invite flow is out
of scope for now; the `invite` token type and default template
still land in Phase 0 so no second schema migration is needed
when it is picked up.

## Architecture decisions

1. Transport (decided): the Workers `send_email` binding is the
   primary Cloudflare transport. It needs no API keys or account
   IDs, which is what makes zero-config install possible. The
   existing REST sender stays for users sending from a different
   Cloudflare account, and the other providers stay untouched.
   The legacy `SENDGRID_*` environment-variable path is
   deprecated: it keeps working in release 1 with a warning in
   the logs and the README, and is removed in release 2.
2. Sending domain (decided): one shared sending domain for the
   whole service. The from address comes from the configured
   provider (or a single `EMAIL_FROM` setting for the binding
   default), and the per-project identity is carried in the
   sender display name and the templates. Per-project from
   addresses can be added later without schema changes.
3. Zero-config default: when no provider row exists in
   `email_providers` and the `EMAIL` binding is present, the
   service uses the binding automatically. Configuring a provider
   in the admin UI overrides this.
4. Tokens: a new `one_time_tokens` table with a `token_type`
   column (confirmation, recovery, magic_link, email_change,
   otp, invite) replaces the dual-use of `password_reset_tokens`.
   This mirrors Supabase's `one_time_tokens` design. Existing
   reset tokens are migrated or allowed to expire (they live one
   hour, so a cutover is safe).
5. Verification: a unified endpoint
   `GET /api/auth/:projectId/verify?type=...&token=...` handles
   all link-based flows, with an optional `redirect_to` that is
   validated against the project's `redirectUrls` allowlist and
   falls back to `siteUrl`. This mirrors the Supabase verify
   endpoint shape.
6. Template variables: one documented set across all templates:
   `{{app_name}}`, `{{project_name}}`, `{{action_url}}`,
   `{{token}}`, `{{otp}}`, `{{email}}`, `{{new_email}}`,
   `{{site_url}}`. Existing variables keep working.

## Phase 0: fixes and groundwork

Tasks:

- Pass `projectId` through the four email call sites in
  `src/index.ts` so per-project templates take effect.
- Fix the Cloudflare REST sender payload: `from` becomes
  `{ address, name }`, and the response check reads the
  documented `{ delivered, permanent_bounces, queued }` result.
- Migration `0001`: create `one_time_tokens` (id, project_id,
  user_id, email, token_hash, token_type, payload JSON,
  expires_at, used_at, created_at) with indexes on token_hash
  and (project_id, email, token_type).
- Extend the `email_templates` type CHECK constraint with
  `invite` and insert a default invite template.
- Point `EmailConfirmationService` and `PasswordResetService` at
  the new table with their respective token types.

Tests (written first, per the TDD rule in CLAUDE.md):

- `test/services/email-service.test.ts`: project template is
  selected when `projectId` is passed.
- `test/services/email-providers.test.ts`: REST payload shape
  for the Cloudflare sender.
- Token type isolation: a confirmation token is rejected by the
  password reset flow and vice versa.

## Phase 1: native Cloudflare Email binding

Tasks:

- Add the binding to `wrangler.toml`:

```toml
[[send_email]]
name = "EMAIL"
```

- Generate types with `npx wrangler types` and use the generated
  `SendEmail` types instead of hand-written ones.
- New `CloudflareBindingProvider` implementing `IEmailProvider`
  that calls `env.EMAIL.send()` with
  `from: { email, name }`, always sending both `html` and `text`
  bodies (deliverability requirement).
- Map binding error codes to application errors and audit
  events: `E_SENDER_NOT_VERIFIED` (domain not onboarded),
  `E_RECIPIENT_SUPPRESSED` (bounced or complained address),
  `E_RATE_LIMIT_EXCEEDED` and `E_DAILY_LIMIT_EXCEEDED` (retry or
  surface), `E_VALIDATION_ERROR` (fix payload, never retry).
- Register the zero-config default described in decision 2, and
  add `cloudflare_binding` to `EmailProviderType` so it can also
  be selected explicitly in the admin UI.
- Local development: document `remote = true` on the binding so
  `wrangler dev` proxies real sends, with a warning that emails
  actually go out.
- Document domain onboarding, which is the one step Cloudflare
  requires before the first send:

```bash
npx wrangler email sending enable yourdomain.com
npx wrangler email sending dns get yourdomain.com
```

- Onboarding auto-adds SPF and DKIM records. Document the
  recommended DMARC record as a manual follow-up.

Phase 1 tests:

- Binding provider called with correct payload shape (mock
  `env.EMAIL.send`).
- Error code mapping for each `E_*` class.
- Fallback selection: no provider rows plus binding present
  selects the binding; a default provider row wins over it.

## Phase 2: auth email flow parity

New public endpoints, all rate-limited via the existing
`rate-limit-service` and all writing audit events:

- `POST /api/auth/:projectId/magic-link`: accepts email and
  optional `redirect_to`, creates a `magic_link` token (15 min
  expiry), sends the magic link template. Verification signs the
  user in and returns the standard token pair.
- `POST /api/auth/:projectId/otp` and
  `POST /api/auth/:projectId/otp/verify`: 6-digit numeric code,
  hashed at rest, 10 minute expiry, maximum 5 verify attempts
  per token, then the token is invalidated.
- `POST /api/auth/:projectId/change-email` (authenticated):
  creates an `email_change` token bound to the new address and
  emails the new address. On verification the user's email is
  swapped and `emailVerified` is set true. Optionally a notice
  is sent to the old address (see follow-up question 4).
- `POST /api/auth/:projectId/resend-confirmation`: public
  resend with a 60 second cooldown per email address and the
  same neutral response whether or not the account exists.
- `GET /api/auth/:projectId/verify`: unified verifier for
  confirmation, recovery, magic_link, and email_change tokens,
  with `redirect_to` allowlist validation. Existing
  `confirm-email` and reset endpoints stay as thin wrappers for
  backward compatibility. The verifier is written so the
  deferred `invite` type can be added as one more branch.

Phase 2 tests:

- One test file per flow under `test/services/` and route tests
  covering: happy path, expired token, reused token, wrong
  project, wrong type, rate limiting, `redirect_to` rejected
  when not allowlisted, neutral responses for unknown emails.

## Phase 3: template upgrade and admin UI

Tasks:

- Replace all placeholder default templates with polished,
  responsive HTML (table-based layout for client compatibility,
  a prominent CTA button, a plain-URL fallback line, footer with
  `{{app_name}}`, and a matching plain-text body) for all seven
  types: welcome, confirmation, password_reset, magic_link,
  email_change, otp, invite. Shipped via migration as new
  system-template defaults; existing customized rows are not
  overwritten.
- Admin UI: template editor gains a live preview with sample
  data, a variables reference panel, and a "send test email to
  me" action backed by
  `POST /api/admin/email-templates/:type/test`.
- Provider screen gains a connection test action backed by
  `POST /api/admin/email-providers/:id/test`.

Phase 3 tests:

- Rendering: every default template renders with the standard
  variable set and leaves no unresolved `{{...}}` markers.
- Test-send endpoints require admin auth and call the provider.

## Phase 4: one-click deploy integration

The README button
(`deploy.workers.cloudflare.com/?url=...`) already provisions
the Worker, D1, and migrations. Email needs two additions:

Tasks:

- Keep the `send_email` binding in `wrangler.toml` (from
  Phase 1) so every deployment, including button deployments,
  gets the binding automatically with no keys to configure.
- Verify the button flow tolerates the hardcoded
  `database_id` in `wrangler.toml`; if the deploy flow does not
  substitute it for the fork, replace it with a placeholder and
  document `npm run db:create`.
- First-run experience: the admin dashboard shows a setup
  banner when no email domain is onboarded (detected by
  catching `E_SENDER_NOT_VERIFIED` from a probe or first send),
  with the exact `wrangler email sending enable` command and a
  dashboard link. Domain onboarding is the one step that cannot
  be automated by the button, because it adds DNS records to a
  zone in the user's account.
- README: rewrite the post-deploy section into a checklist:
  secrets, admin password change, email domain onboarding,
  DMARC recommendation.

Phase 4 tests:

- Setup-state endpoint returns correct status for: no binding,
  binding without onboarded domain, fully configured.

## Phase 5: observability and operations

Tasks:

- Audit events for every send: `email_sent`, `email_failed`,
  `email_suppressed`, with template type and provider in the
  event data.
- Admin endpoint surfacing the account sending quota via
  `GET accounts/{id}/email/sending/limits` when REST credentials
  are available; hidden otherwise.
- Cleanup job guidance for expired `one_time_tokens` rows
  (scheduled Worker cron, daily).

Phase 5 tests:

- Audit events written on success and on each failure class.

## Verification checklist

Before the plan is marked done:

- `npm test` passes with new tests for every phase.
- `npm run type-check` passes.
- Manual end-to-end run on a fresh deployment: deploy via the
  button, onboard a domain, register a user, and complete
  confirmation, magic link, OTP, password reset, email change,
  and invite flows against a real inbox.
- Emails land in the inbox (not spam) for at least one major
  provider, with SPF and DKIM passing.

## Risks and notes

- Cloudflare Email Service launched in 2025 and is evolving;
  API shapes should be re-verified against the docs at
  implementation time.
- Sending requires a domain onboarded in the same Cloudflare
  account as the Worker. Deployments without a domain cannot
  send email until one is added; the Phase 4 banner covers this.
- Email Service is restricted to transactional email, which
  matches every flow in this plan.
- The SMTP provider (nodemailer) predates this plan; its
  viability inside Workers is not a blocker here and is left
  as is.

## Decisions recorded

Answered by the project owner on 2026-07-05:

1. Transport: Workers binding primary, REST for cross-account
   use, `SENDGRID_*` legacy path deprecated (removed in
   release 2).
2. Release scope: phases 0 and 1 ship first; phases 2 through 5
   follow as a second release.
3. Flow scope: magic link, email OTP, and change email are in.
   Admin invite is deferred (schema groundwork still lands in
   Phase 0).
4. Sending domain: one shared sending domain for all projects,
   with per-project identity in the display name and templates.

## Follow-up questions

Answers to these complete the plan; implementation of the
affected tasks waits until they are resolved.

1. Email change safety: notify only the new address, or follow
   the Supabase secure model and require or notify the old
   address as well? (Affects Phase 2; recommendation: notify
   the old address too.)
2. Deploy button: is `evilUrge/cloudflare-auth` the canonical
   public repo the button should point at?
3. OTP shape: 6-digit numeric with 10 minute expiry and 5
   attempts is the proposed default; confirm or adjust.
