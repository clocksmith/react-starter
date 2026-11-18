import { useId, type ReactNode } from 'react';
import { ContentArea } from './theme.js';

/** Ordinary page structure. Feature code supplies content, never layout values. */
export function PageSurface({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="ui-page">
      <header className="ui-page-bar">
        <h1 className="ui-page-title">{title}</h1>
      </header>
      <main>
        <ContentArea>
          <Section>{children}</Section>
        </ContentArea>
      </main>
    </div>
  );
}

/** Vertical content rhythm shared by pages, forms and cards. */
export function Section({ children }: { readonly children: ReactNode }) {
  return <div className="ui-section">{children}</div>;
}

/** A row of related actions that wraps on narrow screens. */
export function ActionGroup({ children }: { readonly children: ReactNode }) {
  return <div className="ui-action-group">{children}</div>;
}

/** A low-emphasis action. Omit `onPress` to disable it. */
export function SecondaryAction({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      className="ui-button ui-button-text"
      disabled={!onPress}
      onClick={onPress}
    >
      {label}
    </button>
  );
}

export function SectionHeading({
  title,
  eyebrow,
  description,
}: {
  readonly title: string;
  readonly eyebrow?: string;
  readonly description?: string;
}) {
  return (
    <div className="ui-heading">
      {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
      <h2 className="ui-heading-title">{title}</h2>
      {description && <p className="ui-heading-description">{description}</p>}
    </div>
  );
}

export function ContentCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className="ui-card ui-card-padded">
      <Section>{children}</Section>
    </div>
  );
}

export function BodyCopy({ children }: { readonly children: string }) {
  return <p className="ui-body">{children}</p>;
}

/** A navigable resource, independent of models, repositories or accounts. */
export function ActionTile({
  title,
  status,
  onPress,
  highlighted = false,
}: {
  readonly title: string;
  readonly status: ReactNode;
  readonly onPress: () => void;
  readonly highlighted?: boolean;
}) {
  return (
    <button type="button" className="ui-card ui-tile" onClick={onPress}>
      <span className="ui-tile-mark" data-highlighted={highlighted} aria-hidden="true" />
      <span className="ui-tile-text">
        <span className="ui-tile-title">{title}</span>
        {/* A space keeps the title and status as separate words in the button's accessible name. */}{' '}
        {status}
      </span>
      <span className="ui-tile-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export function StatusBadge({
  label,
  highlighted = false,
}: {
  readonly label: string;
  readonly highlighted?: boolean;
}) {
  return (
    <span className="ui-badge" data-highlighted={highlighted}>
      {label}
    </span>
  );
}

/** A labelled multi-line text field. The caller owns the text. */
export function NoteInput({
  value,
  onChange,
  label,
  hint,
  readOnly = false,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly hint: string;
  readonly readOnly?: boolean;
}) {
  const id = useId();
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="ui-textarea"
        rows={3}
        value={value}
        placeholder={hint}
        readOnly={readOnly}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
