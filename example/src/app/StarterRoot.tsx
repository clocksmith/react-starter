import { SessionCoordinator } from '@react-starter/core';
import { useEffect, useRef, useState } from 'react';
import { MemoryTaskServer } from '../features/tasks/infrastructure/memoryTaskServer';
import { SessionTaskRepository } from '../features/tasks/infrastructure/sessionTaskRepository';
import { StarterApp } from './App';
import { createOperationId, ServicesProvider, type AppServices } from './composition';

/**
 * The demo's services: a fresh coordinator and an in-memory server. This is the only place that
 * names the concrete repository and its adapter; swap it for real adapters in a real app.
 */
export function createDemoServices(options: { latencyMs?: number } = {}): AppServices {
  const memoryServer = new MemoryTaskServer(options);
  return {
    coordinator: new SessionCoordinator(),
    memoryServer,
    createTaskRepository: (session) =>
      new SessionTaskRepository({
        session,
        api: memoryServer.forAccount(session.key.identity),
        newOperationId: createOperationId,
      }),
  };
}

/**
 * Owns the external coordinator, including its asynchronous shutdown.
 *
 * The services are created in an effect and held in state. React may mount, unmount and mount
 * again in development; each mount then gets its own coordinator and disposes exactly that one.
 * `createServices` is read once per mount.
 */
export function StarterRoot({
  createServices = createDemoServices,
}: {
  readonly createServices?: () => AppServices;
}) {
  const [services, setServices] = useState<AppServices | null>(null);
  const factory = useRef(createServices);

  useEffect(() => {
    const created = factory.current();
    setServices(created);
    return () => {
      setServices(null);
      void created.coordinator.dispose().catch(() => {});
    };
  }, []);

  if (!services) return null;
  return (
    <ServicesProvider services={services}>
      <StarterApp />
    </ServicesProvider>
  );
}
