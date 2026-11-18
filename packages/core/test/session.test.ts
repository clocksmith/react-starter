import { afterEach, describe, expect, it } from 'vitest';
import { AppFailure, SessionCoordinator, type SessionState } from '../src/index.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('SessionCoordinator', () => {
  const coordinators: SessionCoordinator[] = [];
  const create = () => {
    const coordinator = new SessionCoordinator();
    coordinators.push(coordinator);
    return coordinator;
  };
  afterEach(async () => {
    await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.dispose()));
  });

  it('revokes synchronously on a switch and waits for cleanup', async () => {
    const coordinator = create();
    await coordinator.activate({ accountId: 'A' });
    const old = coordinator.state.session!;
    const cleanup = deferred();
    old.registerCleanup(() => cleanup.promise);
    const switching = coordinator.activate({ accountId: 'B' });
    expect(old.isActive).toBe(false);
    expect(coordinator.state.status).toBe('transitioning');
    expect(() => old.requireActive()).toThrow(AppFailure);
    await tick();
    expect(coordinator.state.session).toBeUndefined();
    cleanup.resolve();
    await switching;
    expect(coordinator.state.session!.key.identity.accountId).toBe('B');
  });

  it('gives the same account and a tenant change distinct session keys', async () => {
    const coordinator = create();
    const identity = { accountId: 'A', tenantId: 'one' };
    await coordinator.activate(identity);
    const first = coordinator.state.session!.key;
    await coordinator.signOut();
    await coordinator.activate(identity);
    const second = coordinator.state.session!.key;
    await coordinator.activate({ accountId: 'A', tenantId: 'two' });
    const third = coordinator.state.session!.key;
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    // Keys from another coordinator never collide, and the id carries no account data.
    const other = create();
    await other.activate(identity);
    expect(other.state.session!.key.id).not.toBe(first.id);
    expect(first.id).not.toContain('A');
  });

  it('does not let late preparation publish an obsolete session', async () => {
    const coordinator = create();
    const entered = deferred();
    const release = deferred();
    const readyAccounts: string[] = [];
    coordinator.watch((state) => {
      if (state.session) readyAccounts.push(state.session.key.identity.accountId);
    });
    let activeWhenReleased: boolean | undefined;
    const first = coordinator.activate(
      { accountId: 'A' },
      {
        prepare: async (session) => {
          entered.resolve();
          await release.promise;
          activeWhenReleased = session.isActive;
        },
      },
    );
    await entered.promise;
    const second = coordinator.activate({ accountId: 'B' });
    release.resolve();
    await Promise.all([first, second]);
    await tick();
    expect(activeWhenReleased).toBe(false);
    expect(readyAccounts).toEqual(['B']);
  });

  it('keeps the account closed when cleanup fails, and lets the switch be retried', async () => {
    const coordinator = create();
    await coordinator.activate({ accountId: 'A' });
    let attempts = 0;
    let otherCleanup = 0;
    coordinator.state.session!.registerCleanup(() => {
      if (++attempts === 1) throw new Error('private storage unavailable');
    });
    coordinator.state.session!.registerCleanup(() => {
      otherCleanup++;
    });
    const failed = coordinator.activate({ accountId: 'B' });
    await expect(failed).rejects.toBeInstanceOf(AppFailure);
    // The underlying error is reachable in memory but never serialized.
    const failure = await failed.catch((error: AppFailure) => error);
    expect(String(failure)).toBe('AppFailure(unexpected)');
    expect(JSON.stringify(failure)).toBe('{"kind":"unexpected"}');
    expect(coordinator.state.status).toBe('failed');
    expect(coordinator.state.session).toBeUndefined();
    await coordinator.activate({ accountId: 'B' });
    expect(coordinator.state.status).toBe('ready');
    expect(attempts).toBe(2);
    expect(otherCleanup).toBe(1);
  });

  it('revokes pending work and ends subscriptions on dispose', async () => {
    const coordinator = new SessionCoordinator();
    await coordinator.activate({ accountId: 'A' });
    const handle = coordinator.state.session!;
    let cleaned = 0;
    handle.registerCleanup(() => {
      cleaned++;
    });
    const done = deferred();
    const seen: SessionState['status'][] = [];
    coordinator.watch((state) => seen.push(state.status), done.resolve);
    const closing = coordinator.dispose();
    expect(handle.isActive).toBe(false);
    await closing;
    await done.promise;
    await coordinator.dispose();
    expect(cleaned).toBe(1);
    expect(seen).toEqual(['ready', 'closed']);
    await expect(coordinator.activate({ accountId: 'B' })).rejects.toThrow('closed');
    // A late subscriber gets nothing further and cannot keep the coordinator alive.
    const late: string[] = [];
    coordinator.subscribe((state) => late.push(state.status))();
    expect(late).toEqual([]);
  });

  it('returns the same state object until the next transition', async () => {
    const coordinator = create();
    await coordinator.activate({ accountId: 'A' });
    expect(coordinator.state).toBe(coordinator.state);
    const before = coordinator.state;
    await coordinator.signOut();
    expect(coordinator.state).not.toBe(before);
  });
});
