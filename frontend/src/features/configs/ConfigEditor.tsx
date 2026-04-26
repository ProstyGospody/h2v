import { useEffect, useMemo, useRef } from 'react';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { cn } from '@/lib/utils';

type ConfigEditorProps = {
  className?: string;
  label?: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  value: string;
};

const configEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'hsl(var(--card))',
      color: 'hsl(var(--foreground))',
      fontSize: '12px',
      height: '100%',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-app-mono)',
      lineHeight: '1.55',
    },
    '.cm-content': {
      caretColor: 'hsl(var(--ring))',
      minHeight: '100%',
      padding: '16px 0',
    },
    '.cm-line': {
      padding: '0 18px',
    },
    '.cm-gutters': {
      backgroundColor: 'hsl(var(--card))',
      borderRight: '1px solid hsl(var(--border) / 0.55)',
      color: 'hsl(var(--muted-foreground))',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '44px',
      padding: '0 12px 0 16px',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'hsl(var(--accent) / 0.58)',
    },
    '.cm-activeLineGutter': {
      color: 'hsl(var(--foreground))',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'hsl(var(--ring) / 0.28) !important',
    },
    '.cm-cursor': {
      borderLeftColor: 'hsl(var(--ring))',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'hsl(var(--success) / 0.16)',
      outline: '1px solid hsl(var(--success) / 0.35)',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: 'hsl(var(--destructive) / 0.14)',
      outline: '1px solid hsl(var(--destructive) / 0.35)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'hsl(var(--warning) / 0.24)',
      outline: '1px solid hsl(var(--warning) / 0.28)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'hsl(var(--ring) / 0.32)',
    },
    '.cm-panels': {
      backgroundColor: 'hsl(var(--popover))',
      borderColor: 'hsl(var(--border))',
      color: 'hsl(var(--popover-foreground))',
    },
    '.cm-textfield': {
      backgroundColor: 'hsl(var(--background))',
      border: '1px solid hsl(var(--input))',
      borderRadius: '6px',
      color: 'hsl(var(--foreground))',
      fontFamily: 'var(--font-app-mono)',
      padding: '2px 7px',
    },
    '.cm-button': {
      backgroundColor: 'hsl(var(--secondary))',
      backgroundImage: 'none',
      border: '1px solid hsl(var(--border))',
      borderRadius: '6px',
      color: 'hsl(var(--secondary-foreground))',
      fontFamily: 'var(--font-app-sans)',
      padding: '2px 8px',
    },
    '.cm-tooltip': {
      backgroundColor: 'hsl(var(--popover))',
      border: '1px solid hsl(var(--border))',
      borderRadius: '8px',
      color: 'hsl(var(--popover-foreground))',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'hsl(var(--ring) / 0.2)',
      color: 'hsl(var(--foreground))',
    },
    '.cm-diagnostic': {
      fontFamily: 'var(--font-app-sans)',
      fontSize: '12px',
    },
  },
  { dark: true },
);

export function ConfigEditor({
  className,
  label = 'Configuration editor',
  onChange,
  readOnly = false,
  value,
}: ConfigEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const extensions = useMemo<Extension[]>(
    () => [
      basicSetup,
      json(),
      lintGutter(),
      linter(jsonParseLinter(), { delay: 250 }),
      EditorView.lineWrapping,
      configEditorTheme,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !syncingRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ],
    [readOnly],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions,
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
      }
    };
  }, [extensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current === value) return;

    syncingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, insert: value, to: view.state.doc.length },
      });
    } finally {
      syncingRef.current = false;
    }
  }, [value]);

  return (
    <div
      aria-label={label}
      className={cn(
        'h-full min-h-[360px] overflow-hidden rounded-md border border-border/65 bg-card shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]',
        '[&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto',
        className,
      )}
      ref={hostRef}
      role="region"
    />
  );
}
