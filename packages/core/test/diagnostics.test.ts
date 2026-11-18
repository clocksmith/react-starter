import { describe, expect, it } from 'vitest';
import {
  AppFailure,
  Diagnostics,
  serializeDiagnostic,
  type DiagnosticEvent,
} from '../src/index.js';

describe('Diagnostics', () => {
  it('cannot serialize failure causes or private text', () => {
    const records: unknown[] = [];
    const diagnostics = new Diagnostics({ sink: (record) => records.push(record) });
    const failure = new AppFailure('conflict', {
      cause: new Error('token=secret user@example.test'),
    });
    // A caller that defeats the type system still cannot get free text out.
    const smuggled = {
      operation: 'submit',
      outcome: 'failed',
      failure: failure.kind,
      elapsedMs: 12.4,
      note: 'private note',
      url: 'https://example.test/tasks/1?token=secret',
    } as unknown as DiagnosticEvent;
    diagnostics.record(smuggled);
    expect(records).toEqual([
      { operation: 'submit', outcome: 'failed', failure: 'conflict', elapsedMs: 12 },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/secret|private|example/);
    expect(Object.isFrozen(records[0])).toBe(true);
    const hostile = { operation: 'token=secret', outcome: 'x', failure: 'y', elapsedMs: 'z' };
    expect(serializeDiagnostic(hostile as unknown as DiagnosticEvent)).toEqual({
      operation: 'read',
      outcome: 'failed',
    });
  });

  it('survives a failing sink', () => {
    const diagnostics = new Diagnostics({
      sink: () => {
        throw new Error('sink down');
      },
    });
    expect(() => diagnostics.record({ operation: 'read', outcome: 'succeeded' })).not.toThrow();
    expect(() =>
      new Diagnostics().record({ operation: 'read', outcome: 'succeeded' }),
    ).not.toThrow();
  });
});
