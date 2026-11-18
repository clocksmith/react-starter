import type { AppFailure, SessionHandle, SessionState } from '@react-starter/core';
import { Fragment, type ReactNode } from 'react';

/**
 * Replaces the entire private subtree (including its navigation and local drafts) on a switch.
 * Pass the coordinator's current state, not a value retained from an earlier render.
 */
export function SessionGate({
  state,
  signedOut,
  transitioning,
  failure,
  ready,
}: {
  readonly state: SessionState;
  readonly signedOut: () => ReactNode;
  readonly transitioning: () => ReactNode;
  readonly failure: (failure: AppFailure) => ReactNode;
  readonly ready: (session: SessionHandle) => ReactNode;
}) {
  const session = state.session;
  if (state.status === 'ready' && session?.isActive) {
    // A new session key unmounts everything below and mounts it fresh: no state of the previous
    // account, however deeply nested, survives into the next one.
    return <Fragment key={session.key.id}>{ready(session)}</Fragment>;
  }
  if (state.status === 'signedOut' || state.status === 'closed') return signedOut();
  if (state.status === 'failed' && state.failure) return failure(state.failure);
  return transitioning();
}
