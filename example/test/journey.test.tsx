// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoServices, StarterRoot } from '../src/app/StarterRoot';
import { failureMessage, Strings } from '../src/l10n/strings';

afterEach(cleanup);

const button = (name: string) => screen.findByRole('button', { name });
const press = async (name: string) => userEvent.click(await button(name));
const tile = (title: RegExp) => screen.findByRole('button', { name: title });

describe('task journey against the synthetic backend', () => {
  it('signs in, completes a task, recovers from failures, and isolates accounts', async () => {
    render(
      <StrictMode>
        <StarterRoot createServices={() => createDemoServices({ latencyMs: 5 })} />
      </StrictMode>,
    );

    // Sign in to account A and open its first task.
    await press(Strings.accountA);
    await userEvent.click(await tile(/A: Plan the first release/));
    expect(await screen.findByRole('heading', { name: 'A: Plan the first release' })).toBeTruthy();

    // The primary action is unavailable until there is a note.
    expect(await button(Strings.complete)).toHaveProperty('disabled', true);
    const note = screen.getByRole('textbox', { name: Strings.note });
    await userEvent.type(note, 'Shipped the plan');

    // A rejected completion keeps the draft and explains what to do.
    await press(Strings.rejectNext);
    expect(await screen.findByText(Strings.failureArmed)).toBeTruthy();
    await press(Strings.complete);
    expect(await screen.findByText(failureMessage('validation'))).toBeTruthy();
    expect(screen.getByRole('textbox', { name: Strings.note })).toHaveProperty(
      'value',
      'Shipped the plan',
    );
    expect(screen.getByText(Strings.open)).toBeTruthy();

    // A lost response leaves the outcome uncertain: the same completion is retried, not a new one.
    await press(Strings.loseNext);
    await press(Strings.complete);
    expect(await screen.findByText(failureMessage('unavailable'))).toBeTruthy();
    expect(screen.getByRole('textbox', { name: Strings.note })).toHaveProperty('readOnly', true);
    await press(Strings.retryCompletion);
    expect(await screen.findByText('Shipped the plan')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(Strings.completed)).toBeTruthy());
    expect(screen.queryByRole('textbox', { name: Strings.note })).toBeNull();

    // Back on the list, the completed state is shared.
    await press(Strings.back);
    const completedTile = await tile(/A: Plan the first release/);
    expect(within(completedTile).getByText(Strings.completed)).toBeTruthy();

    // Open the second task and leave an unsent draft behind.
    await userEvent.click(await tile(/A: Review the checklist/));
    await userEvent.type(
      await screen.findByRole('textbox', { name: Strings.note }),
      'Private to A',
    );

    // Switching account shows none of A's content and starts B at its own list.
    await press(Strings.accountB);
    expect(await tile(/B: Plan the first release/)).toBeTruthy();
    expect(screen.queryByText(/A: /)).toBeNull();
    expect(screen.queryByText('Private to A')).toBeNull();
    expect(screen.queryByText('Shipped the plan')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: Strings.tasks })).toBeTruthy();
    const firstForB = await tile(/B: Plan the first release/);
    expect(within(firstForB).getByText(Strings.open)).toBeTruthy();

    // B's detail screen starts with an empty draft.
    await userEvent.click(firstForB);
    expect(await screen.findByRole('textbox', { name: Strings.note })).toHaveProperty('value', '');

    // Back in A, the server still has the completed task; the draft is gone.
    await press(Strings.accountA);
    const backInA = await tile(/A: Plan the first release/);
    await waitFor(() => expect(within(backInA).getByText(Strings.completed)).toBeTruthy());
    await userEvent.click(await tile(/A: Review the checklist/));
    expect(await screen.findByRole('textbox', { name: Strings.note })).toHaveProperty('value', '');

    // Signing out returns to the account chooser with no task content.
    await press(Strings.signOut);
    expect(await screen.findByRole('heading', { name: Strings.chooseAccount })).toBeTruthy();
    expect(screen.queryByText(/Plan the first release/)).toBeNull();
  });

  it('is operable from the keyboard alone', async () => {
    render(<StarterRoot createServices={() => createDemoServices({ latencyMs: 0 })} />);
    const user = userEvent.setup();
    (await button(Strings.accountA)).focus();
    await user.keyboard('{Enter}');
    (await tile(/A: Review the checklist/)).focus();
    await user.keyboard(' ');
    const note = await screen.findByRole('textbox', { name: Strings.note });
    note.focus();
    await user.keyboard('Checked');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: Strings.complete }));
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Checked')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(Strings.completed)).toBeTruthy());
  });
});
