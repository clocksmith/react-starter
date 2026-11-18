import { SessionCoordinator, type SessionHandle, type SessionState } from '@react-starter/core';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { TaskRepository } from '../features/tasks/domain/task';
import type { MemoryTaskServer } from '../features/tasks/infrastructure/memoryTaskServer';
import { TaskRepositoryContext } from '../features/tasks/presentation/taskContext';

/** A repository whose lifetime composition owns. */
export type SessionRepository = TaskRepository & { close(): void };

/** Everything the app needs from outside React. Tests supply their own. */
export type AppServices = {
  readonly coordinator: SessionCoordinator;
  /** Builds the concrete repository for one session. Called once per mount of that session. */
  readonly createTaskRepository: (session: SessionHandle) => SessionRepository;
  /** Present only in the demo, where failures can be simulated. */
  readonly memoryServer?: MemoryTaskServer;
};

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('Bootstrap must supply AppServices');
  return services;
}

/** The coordinator's current state. Re-renders on every transition. */
export function useSessionState(): SessionState {
  const { coordinator } = useServices();
  return useSyncExternalStore(coordinator.subscribe, () => coordinator.state);
}

/** Commands for changing account. Failures surface through the session state, not as throws. */
export function useSessionCommands() {
  const { coordinator } = useServices();
  return useMemo(
    () => ({
      activate: (accountId: string) => {
        // The coordinator publishes a safe failure state; the gate renders it.
        void coordinator.activate({ accountId }).catch(() => {});
      },
      signOut: () => {
        void coordinator.signOut().catch(() => {});
      },
    }),
    [coordinator],
  );
}

/** Random, unguessable operation ids for idempotent writes. */
export function createOperationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Owns the concrete repository for one session and closes it when that session ends. Rendered
 * inside the session gate, so it is created fresh for every activation.
 */
export function SessionScope({
  session,
  children,
}: {
  readonly session: SessionHandle;
  readonly children: ReactNode;
}) {
  const { createTaskRepository } = useServices();
  const [repository, setRepository] = useState<TaskRepository | null>(null);

  // Created in an effect, not during render or in useMemo: React may run effects twice in
  // development, and a repository made during render would be closed while still in use.
  useEffect(() => {
    if (!session.isActive) return;
    const created = createTaskRepository(session);
    setRepository(created);
    return () => {
      setRepository(null);
      // The session would close it eventually; closing here releases it as soon as this mount ends.
      created.close();
    };
  }, [session, createTaskRepository]);

  return (
    <TaskRepositoryContext.Provider value={repository}>{children}</TaskRepositoryContext.Provider>
  );
}
