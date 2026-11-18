import type { FailureKind } from '@react-starter/core';

/**
 * The example ships English. Packages accept app-localized strings directly.
 * Replace this catalog with a message-format library when adding locales.
 */
export const Strings = {
  title: 'Starter',
  tasks: 'Tasks',
  welcome: 'A little focus.\nA lot of progress.',
  welcomeDetail: 'A quiet place to keep things moving, one task at a time.',
  chooseAccount: 'Choose your workspace',
  workspace: 'Your workspace',
  taskHeading: 'Make room for progress.',
  taskSubtitle: 'Pick a task, add a note, and move it forward.',
  taskDetail: 'Task details',
  noteHint: 'What did you get done?',
  simulations: 'Try a recovery flow',
  loading: 'Loading tasks',
  empty: 'No tasks',
  retry: 'Retry',
  refresh: 'Refresh',
  back: 'Back to tasks',
  note: 'Completion note',
  complete: 'Complete task',
  saving: 'Saving',
  completed: 'Completed',
  pending: 'Pending',
  open: 'Open',
  retryCompletion: 'Retry completion',
  signOut: 'Sign out',
  switching: 'Switching account',
  accountA: 'Use account A',
  accountB: 'Use account B',
  demo: 'Example app with synthetic accounts',
  rejectNext: 'Reject next completion',
  loseNext: 'Lose next response',
  failureArmed: 'Failure simulation is ready for the next completion.',
  sessionFailure: 'Account cleanup failed. Retry before continuing.',
} as const;

const failureText: Record<FailureKind, string> = {
  validation: 'Check the note and try again.',
  conflict: 'This task changed. Refresh and review before submitting.',
  unavailable: 'The result is uncertain. Retry the same completion.',
  forbidden: 'This action is not available for your account.',
  unauthenticated: 'Sign in again to continue.',
  sessionExpired: 'Sign in again to continue.',
  unexpected: 'Something went wrong. Try again.',
};

/** Safe, user-facing text for a failure category. Never includes the underlying error. */
export function failureMessage(kind: FailureKind): string {
  return failureText[kind];
}
