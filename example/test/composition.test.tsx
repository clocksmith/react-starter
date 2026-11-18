// @vitest-environment jsdom
import { SessionCoordinator } from '@react-starter/core';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useContext } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ServicesProvider,
  SessionScope,
  useSessionState,
  type AppServices,
} from '../src/app/composition';
import { SessionGate } from '../src/app/SessionGate';
import { createDemoServices, StarterRoot } from '../src/app/StarterRoot';
import type { TaskRepository } from '../src/features/tasks/domain/task';
import { MemoryTaskServer } from '../src/features/tasks/infrastructure/memoryTaskServer';
import { SessionTaskRepository } from '../src/features/tasks/infrastructure/sessionTaskRepository';
import { TaskRepositoryContext } from '../src/features/tasks/presentation/taskContext';
import { Strings } from '../src/l10n/strings';

afterEach(cleanup);

describe('composition', () => {
  it('creates one repository per session, closes the previous one, and tolerates StrictMode', async () => {
    const coordinator = new SessionCoordinator();
    const server = new MemoryTaskServer({ latencyMs: 0 });
    // Every repository the composition ever asks for, including ones a discarded mount created.
    const created: SessionTaskRepository[] = [];
    const services: AppServices = {
      coordinator,
      createTaskRepository: (session) => {
        const repository = new SessionTaskRepository({
          session,
          api: server.forAccount(session.key.identity),
          newOperationId: () => 'operation',
        });
        created.push(repository);
        return repository;
      },
    };
    let provided: TaskRepository | null = null;
    function Probe() {
      provided = useContext(TaskRepositoryContext);
      return <p>{provided ? 'repository ready' : 'no repository'}</p>;
    }
    const open = () => created.filter((repository) => !repository.isClosed);
    function Harness() {
      const state = useSessionState();
      return (
        <SessionGate
          state={state}
          signedOut={() => <p>signed out</p>}
          transitioning={() => <p>switching</p>}
          failure={() => <p>failed</p>}
          ready={(session) => (
            <SessionScope session={session}>
              <Probe />
            </SessionScope>
          )}
        />
      );
    }
    render(
      <StrictMode>
        <ServicesProvider services={services}>
          <Harness />
        </ServicesProvider>
      </StrictMode>,
    );
    expect(screen.getByText('signed out')).toBeTruthy();

    await act(() => coordinator.activate({ accountId: 'A' }));
    await screen.findByText('repository ready');
    // StrictMode mounted the scope twice. The discarded mount's repository is closed at once,
    // not left open until the session ends, and the one provided is the one still open.
    expect(created.length).toBe(2);
    expect(open()).toEqual([provided]);
    const forA = provided;

    await act(() => coordinator.activate({ accountId: 'B' }));
    await screen.findByText('repository ready');
    expect(created.length).toBe(4);
    expect(open()).toEqual([provided]);
    expect(provided).not.toBe(forA);

    await act(() => coordinator.signOut());
    expect(screen.getByText('signed out')).toBeTruthy();
    expect(open()).toEqual([]);
    await coordinator.dispose();
  });

  it('refuses to run without services', () => {
    function Orphan() {
      useSessionState();
      return null;
    }
    const error = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Orphan />)).toThrow('AppServices');
    } finally {
      console.error = error;
    }
  });

  it('boots under StrictMode and disposes every coordinator it created', async () => {
    const created: AppServices[] = [];
    const createServices = () => {
      const services = createDemoServices({ latencyMs: 0 });
      created.push(services);
      return services;
    };
    const { unmount } = render(
      <StrictMode>
        <StarterRoot createServices={createServices} />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: Strings.accountA })).toBeTruthy(),
    );
    // StrictMode mounted twice: the first mount's coordinator is already closed, the second is live.
    expect(created.map((services) => services.coordinator.state.status)).toEqual([
      'closed',
      'signedOut',
    ]);
    await act(() => created[1]!.coordinator.activate({ accountId: 'A' }));
    const session = created[1]!.coordinator.state.session!;
    unmount();
    expect(screen.queryByRole('button', { name: Strings.accountA })).toBeNull();
    expect(created[1]!.coordinator.state.status).toBe('closed');
    expect(session.isActive).toBe(false);
  });
});
