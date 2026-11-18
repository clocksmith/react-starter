import type { ReactNode } from 'react';

export type AsyncContentProps = {
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  readonly retryLabel: string;
  /** Rendered whenever present, including during a refresh and beside a recoverable error. */
  readonly content?: ReactNode;
  readonly loading?: boolean;
  readonly errorMessage?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
};

/**
 * Retains same-session content during refresh and recoverable errors.
 * Apps map their repository state to these inputs and localize all labels.
 */
export function AsyncContent({
  loadingLabel,
  emptyLabel,
  retryLabel,
  content,
  loading = false,
  errorMessage,
  onRetry,
}: AsyncContentProps) {
  const hasContent = content !== undefined && content !== null && content !== false;
  return (
    <div className="ui-async">
      {loading && <progress className="ui-progress" aria-label={loadingLabel} />}
      {hasContent ? content : !loading && !errorMessage && <p className="ui-body">{emptyLabel}</p>}
      {/* Always in the document so the first message is announced too. */}
      <div className="ui-async-error" role="status" aria-live="polite">
        {errorMessage && <p className="ui-error">{errorMessage}</p>}
      </div>
      {errorMessage && onRetry && (
        <button type="button" className="ui-button ui-button-text ui-align-start" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
