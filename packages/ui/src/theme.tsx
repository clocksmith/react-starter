import type { CSSProperties, ReactNode } from 'react';

/** Spacing and width tokens. Components read them as CSS variables; apps may override any of them. */
export type UiSpacing = {
  /** Vertical rhythm between sibling blocks, in CSS pixels at the default text size. */
  readonly gap: number;
  /** Padding inside the content area and cards. */
  readonly inset: number;
  /** Maximum readable width of the content column. */
  readonly contentWidth: number;
};

export const defaultSpacing: UiSpacing = Object.freeze({ gap: 16, inset: 24, contentWidth: 760 });

export type UiThemeProps = {
  /** Brand colour the palette is derived from, as any CSS colour. */
  readonly seedColor: string;
  /** `system` follows the user's operating-system preference. */
  readonly scheme?: 'light' | 'dark' | 'system';
  readonly fontFamily?: string;
  readonly spacing?: Partial<UiSpacing>;
  readonly children: ReactNode;
};

/**
 * Establishes the theme for everything inside it. Sizes are emitted in `rem`, so the whole
 * interface scales with the user's text-size setting.
 */
export function UiTheme({
  seedColor,
  scheme = 'system',
  fontFamily,
  spacing,
  children,
}: UiThemeProps) {
  const tokens = { ...defaultSpacing, ...spacing };
  const style = {
    '--ui-seed': seedColor,
    '--ui-gap': `${tokens.gap / 16}rem`,
    '--ui-inset': `${tokens.inset / 16}rem`,
    '--ui-content-width': `${tokens.contentWidth / 16}rem`,
    ...(fontFamily ? { '--ui-font': fontFamily } : {}),
  } as CSSProperties;
  return (
    <div className="ui-theme" data-ui-scheme={scheme} style={style}>
      {children}
    </div>
  );
}

/** Centres content in a readable column with the theme's inset. */
export function ContentArea({ children }: { readonly children: ReactNode }) {
  return <div className="ui-content-area">{children}</div>;
}
