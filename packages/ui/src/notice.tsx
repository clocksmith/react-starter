import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Notify = (text: string) => void;

const NoticeContext = createContext<Notify | null>(null);

/**
 * Hosts brief confirmations for everything inside it. The message region stays in the document, so
 * assistive technology announces each new notice without focus moving.
 */
export function NoticeHost({
  children,
  durationMs = 4000,
}: {
  readonly children: ReactNode;
  readonly durationMs?: number;
}) {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback<Notify>(
    (next) => {
      if (timer.current) clearTimeout(timer.current);
      setText(next);
      timer.current = setTimeout(() => setText(''), durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => notify, [notify]);
  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div className="ui-notice" role="status" aria-live="polite" data-visible={text !== ''}>
        {text}
      </div>
    </NoticeContext.Provider>
  );
}

/** Returns a function that shows a brief confirmation. Requires a NoticeHost above. */
export function useNotice(): Notify {
  const notify = useContext(NoticeContext);
  if (!notify) throw new Error('useNotice requires a NoticeHost above it');
  return notify;
}
