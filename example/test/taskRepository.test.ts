import { AppFailure, SessionCoordinator } from '@react-starter/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task, TaskListResource, TaskResource } from '../src/features/tasks/domain/task';
import { MemoryTaskServer } from '../src/features/tasks/infrastructure/memoryTaskServer';
import { SessionTaskRepository } from '../src/features/tasks/infrastructure/sessionTaskRepository';
import type { TaskApi } from '../src/features/tasks/infrastructure/taskApi';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const task = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Task',
  revision: 7,
  versionToken: 'opaque-token-from-server',
  completed: false,
  note: '',
  ...overrides,
});

/** An API whose list and write responses the test releases by hand. */
class ControlledApi implements TaskApi {
  readonly listResponse = deferred<Task[]>();
  readonly writeResponse = deferred<Task>();
  writes = 0;
  etags: string[] = [];
  list = () => this.listResponse.promise;
  read = async (id: string) => task({ id });
  complete = (_id: string, request: { note: string; etag: string; operationId: string }) => {
    this.writes++;
    this.etags.push(request.etag);
    return this.writeResponse.promise;
  };
}

describe('SessionTaskRepository', () => {
  let coordinator: SessionCoordinator;
  let operation = 0;
  const A = { accountId: 'A' };

  beforeEach(async () => {
    coordinator = new SessionCoordinator();
    await coordinator.activate(A);
  });
  afterEach(() => coordinator.dispose());

  const repository = (api: TaskApi) =>
    new SessionTaskRepository({
      session: coordinator.state.session!,
      api,
      newOperationId: () => `operation-${operation++}`,
    });

  it('does not let a late list regress a write, and duplicate taps share one operation', async () => {
    const api = new ControlledApi();
    const repo = repository(api);
    await repo.refresh('1');
    const refresh = repo.refreshList();
    const first = repo.complete('1', 'Original note');
    const second = repo.complete('1', 'A duplicate note');
    expect(second).toBe(first);
    expect(api.writes).toBe(1);
    // The server's precondition token is sent back unchanged.
    expect(api.etags).toEqual(['opaque-token-from-server']);
    api.writeResponse.resolve(
      task({ revision: 8, versionToken: 'new-token', completed: true, note: 'Original note' }),
    );
    await first;
    // The list response was requested before the write and arrives after it.
    api.listResponse.resolve([task()]);
    await refresh;
    const detail = repo.snapshot('1');
    expect(detail.task!.revision).toBe(8);
    expect(detail.task!.completed).toBe(true);
    expect(detail.task!.note).toBe('Original note');
  });

  it('shares optimistic state between list and detail and rolls back a rejection', async () => {
    const server = new MemoryTaskServer({ latencyMs: 5 });
    const repo = repository(server.forAccount(A));
    await repo.refreshList();
    const lists: TaskListResource[] = [];
    const details: TaskResource[] = [];
    const stopList = repo.watchList(() => lists.push(repo.listSnapshot()));
    const stopDetail = repo.watch('1', () => details.push(repo.snapshot('1')));
    server.simulateNextCompletion(A, 'reject');
    await expect(repo.complete('1', 'Draft')).rejects.toBeInstanceOf(AppFailure);
    await tick();
    expect(lists.some((list) => list.tasks[0]!.pending && list.tasks[0]!.task!.completed)).toBe(
      true,
    );
    expect(details.some((detail) => detail.pending && detail.task!.completed)).toBe(true);
    expect(details.at(-1)!.task!.completed).toBe(false);
    expect(lists.at(-1)!.tasks[0]!.task!.completed).toBe(false);
    expect(details.at(-1)!.needsRetry).toBe(false);
    expect(details.at(-1)!.failure).toBe('validation');
    stopList();
    stopDetail();
  });

  it('retries a lost response with the original key, payload and precondition', async () => {
    const server = new MemoryTaskServer({ latencyMs: 0 });
    const repo = repository(server.forAccount(A));
    await repo.refresh('1');
    server.simulateNextCompletion(A, 'loseResponse');
    await expect(repo.complete('1', 'Original')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(repo.snapshot('1').needsRetry).toBe(true);
    // A different note cannot be sent while the first outcome is unknown.
    await expect(repo.complete('1', 'Changed')).rejects.toMatchObject({ kind: 'conflict' });
    await repo.retryCompletion('1');
    const settled = repo.snapshot('1');
    expect(settled.task!.note).toBe('Original');
    expect(settled.task!.revision).toBe(8);
    expect(settled.needsRetry).toBe(false);
    expect(server.completionRequests).toBe(2);
  });

  it('stops delivering on an account switch and rejects the late write', async () => {
    const api = new ControlledApi();
    const repo = repository(api);
    await repo.refresh('1');
    let changes = 0;
    const stop = repo.watch('1', () => changes++);
    expect(repo.subscriberCount).toBe(1);
    const writing = repo.complete('1', 'Private note');
    const rejection = expect(writing).rejects.toMatchObject({ kind: 'sessionExpired' });
    await coordinator.activate({ accountId: 'B' });
    expect(repo.isClosed).toBe(true);
    expect(repo.subscriberCount).toBe(0);
    const count = changes;
    api.writeResponse.resolve(task({ revision: 8, versionToken: 'new-token', completed: true }));
    await rejection;
    await tick();
    expect(changes).toBe(count);
    // Nothing of the old account is readable afterwards.
    expect(repo.snapshot('1').task).toBeUndefined();
    expect(repo.listSnapshot().tasks).toEqual([]);
    await expect(repo.refreshList()).rejects.toMatchObject({ kind: 'sessionExpired' });
    // Watching a closed repository is a no-op.
    repo.watch('1', () => changes++)();
    expect(repo.subscriberCount).toBe(0);
    stop();
  });

  it('keeps its authority across unsubscribing and resubscribing', async () => {
    const repo = repository(new MemoryTaskServer({ latencyMs: 0 }).forAccount(A));
    await repo.refresh('1');
    const stop = repo.watch('1', () => {});
    expect(repo.subscriberCount).toBe(1);
    stop();
    expect(repo.subscriberCount).toBe(0);
    await repo.complete('1', 'Done');
    expect(repo.snapshot('1').task!.revision).toBe(8);
  });

  it('returns the same snapshot object until the state changes', async () => {
    const repo = repository(new MemoryTaskServer({ latencyMs: 0 }).forAccount(A));
    await repo.refreshList();
    const list = repo.listSnapshot();
    const detail = repo.snapshot('1');
    expect(repo.listSnapshot()).toBe(list);
    expect(repo.snapshot('1')).toBe(detail);
    expect(list.tasks[0]).toBe(detail);
    await repo.complete('1', 'Done');
    expect(repo.listSnapshot()).not.toBe(list);
    expect(repo.snapshot('1')).not.toBe(detail);
  });

  it('rejects invalid completions without sending anything', async () => {
    const server = new MemoryTaskServer({ latencyMs: 0 });
    const repo = repository(server.forAccount(A));
    await expect(repo.complete('1', 'Not loaded yet')).rejects.toMatchObject({
      kind: 'validation',
    });
    await repo.refresh('1');
    await expect(repo.complete('1', '   ')).rejects.toMatchObject({ kind: 'validation' });
    await expect(repo.retryCompletion('1')).rejects.toMatchObject({ kind: 'validation' });
    expect(server.completionRequests).toBe(0);
  });
});

describe('MemoryTaskServer', () => {
  it('isolates failure injection and idempotency by account', async () => {
    const server = new MemoryTaskServer({ latencyMs: 0 });
    const a = { accountId: 'A' };
    const b = { accountId: 'B' };
    server.simulateNextCompletion(a, 'reject');
    const apiB = server.forAccount(b);
    const beforeB = await apiB.read('1');
    const completedB = await apiB.complete('1', {
      note: 'B only',
      etag: beforeB.versionToken,
      operationId: 'same-operation',
    });
    expect(completedB.note).toBe('B only');
    const apiA = server.forAccount(a);
    const beforeA = await apiA.read('1');
    // A's armed rejection is still waiting, and B's stored result is not replayed to A.
    await expect(
      apiA.complete('1', {
        note: 'A only',
        etag: beforeA.versionToken,
        operationId: 'same-operation',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    const completedA = await apiA.complete('1', {
      note: 'A only',
      etag: beforeA.versionToken,
      operationId: 'same-operation',
    });
    expect(completedA.note).toBe('A only');
    expect(completedA.title.startsWith('A:')).toBe(true);
    // Replaying an operation id with a different payload is refused.
    await expect(
      apiA.complete('1', {
        note: 'Different',
        etag: beforeA.versionToken,
        operationId: 'same-operation',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    // A stale precondition is a conflict.
    await expect(
      apiA.complete('2', { note: 'Stale', etag: '"old"', operationId: 'another-operation' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });
});
