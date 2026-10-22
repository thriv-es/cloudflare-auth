import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `audit_logs.event_type` carries a CHECK constraint in the migration, but
 * the Drizzle schema does not declare it. Nothing in the type checker sees
 * that gap, so a service that logs an event type outside the allowed list
 * only fails at runtime — and it fails *after* the work it was recording has
 * already happened.
 *
 * This test reads the allowed list out of the migration and checks every
 * `eventType:` in the source against it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
const MIGRATIONS = join(ROOT, 'migrations');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function allowedEventTypes(): Set<string> {
  const sql = readFileSync(join(MIGRATIONS, '0000_initial.sql'), 'utf8');
  const match = sql.match(/event_type TEXT NOT NULL CHECK \(event_type IN \(([\s\S]*?)\)\)/);
  if (!match) throw new Error('Could not find the event_type CHECK constraint in 0000_initial.sql');
  return new Set(
    [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
  );
}

describe('audit log event types', () => {
  it('every event type the source logs is allowed by the audit_logs CHECK constraint', () => {
    const allowed = allowedEventTypes();
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/eventType:\s*'([a-z_]+)'/g)) {
        if (!allowed.has(m[1])) {
          offenders.push(`${file.replace(ROOT + '/', '')}: ${m[1]}`);
        }
      }
    }

    expect(
      offenders,
      `These event types are not in the audit_logs CHECK constraint and will fail at runtime:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the allowed list was actually parsed', () => {
    expect(allowedEventTypes().size).toBeGreaterThan(10);
  });
});
