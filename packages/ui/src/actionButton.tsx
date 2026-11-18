export type ActionButtonProps = {
  readonly label: string;
  readonly pendingLabel: string;
  /** Omit to disable the button. */
  readonly onPress?: (() => void) | undefined;
  readonly pending?: boolean;
};

/** The primary action. The caller owns pending state and command execution. */
export function ActionButton({ label, pendingLabel, onPress, pending = false }: ActionButtonProps) {
  return (
    <button
      type="button"
      className="ui-button ui-button-primary"
      disabled={pending || !onPress}
      // Announces the change to "Saving" without moving focus.
      aria-live={pending ? 'polite' : undefined}
      aria-busy={pending || undefined}
      onClick={onPress}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
