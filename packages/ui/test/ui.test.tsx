// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActionButton,
  ActionTile,
  AsyncContent,
  NoteInput,
  NoticeHost,
  PageSurface,
  SecondaryAction,
  SectionHeading,
  StatusBadge,
  UiTheme,
  useNotice,
} from '../src/index.js';

afterEach(cleanup);

describe('ActionButton', () => {
  it('runs the command when enabled and announces a pending state without accepting input', async () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <ActionButton label="Complete task" pendingLabel="Saving" onPress={onPress} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Complete task' }));
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender(
      <ActionButton label="Complete task" pendingLabel="Saving" onPress={onPress} pending />,
    );
    const pending = screen.getByRole('button', { name: 'Saving' });
    expect(pending).toHaveProperty('disabled', true);
    expect(pending.getAttribute('aria-live')).toBe('polite');
    await userEvent.click(pending);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is disabled without a command', () => {
    render(<ActionButton label="Complete task" pendingLabel="Saving" />);
    expect(screen.getByRole('button', { name: 'Complete task' })).toHaveProperty('disabled', true);
  });
});

describe('AsyncContent', () => {
  const labels = { loadingLabel: 'Loading tasks', emptyLabel: 'No tasks', retryLabel: 'Retry' };

  it('shows the empty label only when there is nothing to show and nothing in progress', () => {
    const { rerender } = render(<AsyncContent {...labels} />);
    expect(screen.getByText('No tasks')).toBeTruthy();
    rerender(<AsyncContent {...labels} loading />);
    expect(screen.queryByText('No tasks')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Loading tasks' })).toBeTruthy();
  });

  it('keeps content on screen during a refresh and beside a recoverable error', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AsyncContent {...labels} content={<p>Task one</p>} loading />);
    expect(screen.getByText('Task one')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();

    rerender(
      <AsyncContent
        {...labels}
        content={<p>Task one</p>}
        errorMessage="Try again."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Task one')).toBeTruthy();
    // The message sits in a live region, so it is announced without moving focus.
    expect(screen.getByRole('status').textContent).toBe('Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has the live region in the document before any error exists', () => {
    render(<AsyncContent {...labels} content={<p>Task one</p>} />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('surfaces', () => {
  it('gives a page one top-level heading and sections second-level headings', () => {
    render(
      <PageSurface title="Tasks">
        <SectionHeading
          title="Make room for progress."
          eyebrow="Your workspace"
          description="Pick a task."
        />
      </PageSurface>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Make room for progress.' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('exposes a tile as one button named by its title and status, with decoration hidden', async () => {
    const onPress = vi.fn();
    render(
      <ActionTile
        title="Plan the first release"
        status={<StatusBadge label="Open" />}
        onPress={onPress}
      />,
    );
    const tile = screen.getByRole('button', { name: 'Plan the first release Open' });
    await userEvent.click(tile);
    tile.focus();
    await userEvent.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('disables a secondary action that has no command', () => {
    render(<SecondaryAction label="Refresh" />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', true);
  });

  it('labels the note field and reports edits unless read-only', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NoteInput
        value=""
        onChange={onChange}
        label="Completion note"
        hint="What did you get done?"
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Completion note' });
    expect(field.getAttribute('placeholder')).toBe('What did you get done?');
    await userEvent.type(field, 'a');
    expect(onChange).toHaveBeenCalledWith('a');

    onChange.mockClear();
    rerender(
      <NoteInput value="Done" onChange={onChange} label="Completion note" hint="" readOnly />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Completion note' }), 'b');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('theme and notices', () => {
  it('emits spacing tokens in rem so the interface scales with the text size', () => {
    const { container } = render(
      <UiTheme seedColor="#315b54" scheme="dark" spacing={{ gap: 24 }}>
        <p>content</p>
      </UiTheme>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.uiScheme).toBe('dark');
    expect(root.style.getPropertyValue('--ui-gap')).toBe('1.5rem');
    expect(root.style.getPropertyValue('--ui-inset')).toBe('1.5rem');
    expect(root.style.getPropertyValue('--ui-content-width')).toBe('47.5rem');
    expect(root.style.getPropertyValue('--ui-seed')).toBe('#315b54');
  });

  it('announces a notice in a region that is always present', async () => {
    function Trigger() {
      const notify = useNotice();
      return (
        <SecondaryAction label="Arm" onPress={() => notify('Ready for the next completion.')} />
      );
    }
    render(
      <NoticeHost>
        <Trigger />
      </NoticeHost>,
    );
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Arm' }));
    expect(region.textContent).toBe('Ready for the next completion.');
    expect(region.dataset.visible).toBe('true');
  });

  it('refuses to notify without a host', () => {
    function Orphan() {
      useNotice();
      return null;
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow('NoticeHost');
    error.mockRestore();
  });
});
