// @vitest-environment jsdom
import { SessionCoordinator, type SessionHandle } from '@react-starter/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryTaskServer } from '../src/features/tasks/infrastructure/memoryTaskServer';
import { SessionTaskRepository } from '../src/features/tasks/infrastructure/sessionTaskRepository';
import { TaskRepositoryContext } from '../src/features/tasks/presentation/taskContext';
import { useTask, useTaskList } from '../src/features/tasks/presentation/taskHooks';

afterEach(cleanup);

function Probe({ session }: { session: SessionHandle }) {
  const list = useTaskList(session);
  const task = useTask(session, '1');
  return (
    <p>
      list: {list ? list.tasks.map((resource) => resource.task?.title).join(', ') : 'none'}; task:{' '}
      {task?.task?.title ?? 'none'}
    </p>
  );
}

describe('task hooks', () => {
  it('return state only for the session they were asked about', async () => {
    const first = new SessionCoordinator();
    const second = new SessionCoordinator();
    await first.activate({ accountId: 'A' });
    await second.activate({ accountId: 'B' });
    const sessionA = first.state.session!;
    const sessionB = second.state.session!;
    const repositoryForA = new SessionTaskRepository({
      session: sessionA,
      api: new MemoryTaskServer({ latencyMs: 0 }).forAccount({ accountId: 'A' }),
      newOperationId: () => 'operation',
    });
    await repositoryForA.refreshList();

    const { rerender } = render(
      <TaskRepositoryContext.Provider value={repositoryForA}>
        <Probe session={sessionA} />
      </TaskRepositoryContext.Provider>,
    );
    expect(
      screen.getByText(/list: A: Plan the first release, A: Review the checklist; task: A: Plan/),
    ).toBeTruthy();

    // A repository left over from another account must never be shown for this session.
    rerender(
      <TaskRepositoryContext.Provider value={repositoryForA}>
        <Probe session={sessionB} />
      </TaskRepositoryContext.Provider>,
    );
    expect(screen.getByText('list: none; task: none')).toBeTruthy();
    expect(screen.queryByText(/A: /)).toBeNull();

    // With no repository at all, the hooks report nothing and do not throw.
    rerender(
      <TaskRepositoryContext.Provider value={null}>
        <Probe session={sessionB} />
      </TaskRepositoryContext.Provider>,
    );
    expect(screen.getByText('list: none; task: none')).toBeTruthy();
    await Promise.all([first.dispose(), second.dispose()]);
  });
});
