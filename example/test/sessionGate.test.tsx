// @vitest-environment jsdom
import { SessionCoordinator, type SessionState } from '@react-starter/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionGate } from '../src/app/SessionGate';

afterEach(cleanup);

function Draft() {
  const [text, setText] = useState('');
  return (
    <input
      aria-label="draft"
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
    />
  );
}

function Gate({ coordinator }: { coordinator: SessionCoordinator }) {
  const state = useSyncExternalStore(coordinator.subscribe, () => coordinator.state);
  return (
    <SessionGate
      state={state}
      signedOut={() => <p>signed out</p>}
      transitioning={() => <p>switching</p>}
      failure={(failure) => <p>failed: {failure.kind}</p>}
      ready={(session) => (
        <div>
          <p>account {session.key.identity.accountId}</p>
          <Draft />
        </div>
      )}
    />
  );
}

describe('SessionGate', () => {
  it('replaces the private subtree, including local drafts, on every activation', async () => {
    const coordinator = new SessionCoordinator();
    render(<Gate coordinator={coordinator} />);
    expect(screen.getByText('signed out')).toBeTruthy();

    await act(() => coordinator.activate({ accountId: 'A' }));
    await userEvent.type(screen.getByLabelText('draft'), 'private to A');
    expect(screen.getByLabelText('draft')).toHaveProperty('value', 'private to A');

    await act(() => coordinator.activate({ accountId: 'B' }));
    expect(screen.getByText('account B')).toBeTruthy();
    expect(screen.getByLabelText('draft')).toHaveProperty('value', '');

    // Signing in to the same account again is a new session, so it also starts clean.
    await userEvent.type(screen.getByLabelText('draft'), 'B draft');
    await act(() => coordinator.activate({ accountId: 'B' }));
    expect(screen.getByLabelText('draft')).toHaveProperty('value', '');

    await act(() => coordinator.signOut());
    expect(screen.getByText('signed out')).toBeTruthy();
    await act(() => coordinator.dispose());
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('remounts the subtree even when one ready state replaces another in a single render', async () => {
    // React may batch a switch so that no "transitioning" render happens in between. The key on
    // the session is what guarantees a remount in that case. Two coordinators give two live
    // sessions to render back to back.
    const first = new SessionCoordinator();
    const second = new SessionCoordinator();
    await first.activate({ accountId: 'A' });
    await second.activate({ accountId: 'B' });
    const gate = (state: SessionState) => (
      <SessionGate
        state={state}
        signedOut={() => <p>signed out</p>}
        transitioning={() => <p>switching</p>}
        failure={() => <p>failed</p>}
        ready={(session) => (
          <div>
            <p>account {session.key.identity.accountId}</p>
            <Draft />
          </div>
        )}
      />
    );
    const { rerender } = render(gate(first.state));
    await userEvent.type(screen.getByLabelText('draft'), 'private to A');
    rerender(gate(second.state));
    expect(screen.getByText('account B')).toBeTruthy();
    expect(screen.getByLabelText('draft')).toHaveProperty('value', '');
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it('shows no account content while switching or after a failed cleanup', async () => {
    const coordinator = new SessionCoordinator();
    render(<Gate coordinator={coordinator} />);
    await act(() => coordinator.activate({ accountId: 'A' }));
    // Created up front: the coordinator calls the cleanup later, not during activate().
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => (release = resolve));
    coordinator.state.session!.registerCleanup(() => cleanup);
    let switching!: Promise<void>;
    act(() => {
      switching = coordinator.activate({ accountId: 'B' });
    });
    expect(screen.getByText('switching')).toBeTruthy();
    expect(screen.queryByText('account A')).toBeNull();
    await act(async () => {
      release();
      await switching;
    });
    expect(screen.getByText('account B')).toBeTruthy();

    coordinator.state.session!.registerCleanup(() => {
      throw new Error('private storage unavailable');
    });
    await act(() => coordinator.activate({ accountId: 'A' }).catch(() => {}));
    expect(screen.getByText('failed: unexpected')).toBeTruthy();
    expect(screen.queryByText(/account/)).toBeNull();
    await coordinator.dispose().catch(() => {});
  });

  it('does not render the ready branch for a revoked handle', () => {
    const coordinator = new SessionCoordinator();
    const stale: SessionState[] = [];
    coordinator.subscribe((state) => stale.push(state));
    return coordinator.activate({ accountId: 'A' }).then(async () => {
      const ready = stale.find((state) => state.status === 'ready')!;
      await coordinator.signOut();
      // A caller that kept an old state object must not be able to show the old account.
      render(
        <SessionGate
          state={ready}
          signedOut={() => <p>signed out</p>}
          transitioning={() => <p>switching</p>}
          failure={() => <p>failed</p>}
          ready={() => <p>account A</p>}
        />,
      );
      expect(screen.queryByText('account A')).toBeNull();
      expect(screen.getByText('switching')).toBeTruthy();
      await coordinator.dispose();
    });
  });
});
