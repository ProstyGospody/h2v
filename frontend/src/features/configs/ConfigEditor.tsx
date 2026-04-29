import { useEffect, useMemo, useRef } from 'react';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { cn } from '@/lib/utils';

type ConfigEditorProps = {
  className?: string;
  label?: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  value: string;
};

const configHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: '#f0d28a', fontWeight: '500' },
  { tag: tags.string, color: '#9ad6b5' },
  { tag: [tags.number, tags.integer, tags.float], color: '#f4a88a' },
  { tag: [tags.bool, tags.null, tags.atom], color: '#c7b8ff' },
  { tag: tags.keyword, color: '#9fc7ff' },
  { tag: tags.operator, color: '#9fb0c4' },
  { tag: [tags.punctuation, tags.separator], color: '#7f8a9a' },
  { tag: tags.bracket, color: '#d5ddea' },
  { tag: tags.comment, color: '#758197', fontStyle: 'italic' },
  { tag: tags.invalid, color: '#ff8b8b', textDecoration: 'none' },
]);

const configEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'hsl(var(--card))',
      color: '#d7deea',
      fontSize: '12px',
      height: '100%',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-app-mono)',
      lineHeight: '1.62',
    },
    '.cm-content': {
      caretColor: '#8dc5f3',
      minHeight: '100%',
      padding: '18px 0',
    },
    '.cm-line': {
      padding: '0 20px',
    },
    '.cm-gutters': {
      backgroundColor: 'hsl(var(--card))',
      borderRight: '1px solid hsl(var(--border) / 0.55)',
      color: '#697589',
    },
    '.cm-foldGutter': {
      display: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '44px',
      padding: '0 12px 0 16px',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'rgb(141 197 243 / 0.08)',
    },
    '.cm-activeLineGutter': {
      color: '#c7d4e5',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgb(119 180 216 / 0.34) !important',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgb(119 180 216 / 0.18)',
    },
    '.cm-cursor': {
      borderLeftColor: '#8dc5f3',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgb(154 214 181 / 0.14)',
      outline: '1px solid rgb(154 214 181 / 0.34)',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: 'rgb(255 139 139 / 0.14)',
      outline: '1px solid rgb(255 139 139 / 0.34)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgb(240 210 138 / 0.22)',
      outline: '1px solid rgb(240 210 138 / 0.28)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgb(141 197 243 / 0.28)',
    },
    '.cm-panels': {
      backgroundColor: '#101722',
      borderColor: 'rgb(63 74 89 / 0.78)',
      color: '#d7deea',
    },
    '.cm-textfield': {
      backgroundColor: '#080c11',
      border: '1px solid rgb(63 74 89 / 0.85)',
      borderRadius: '6px',
      color: '#d7deea',
      fontFamily: 'var(--font-app-mono)',
      padding: '2px 7px',
    },
    '.cm-button': {
      backgroundColor: '#151e2b',
      backgroundImage: 'none',
      border: '1px solid rgb(63 74 89 / 0.85)',
      borderRadius: '6px',
      color: '#d7deea',
      fontFamily: 'var(--font-app-sans)',
      padding: '2px 8px',
    },
    '.cm-tooltip': {
      backgroundColor: '#101722',
      border: '1px solid rgb(63 74 89 / 0.85)',
      borderRadius: '8px',
      color: '#d7deea',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgb(141 197 243 / 0.18)',
      color: '#f4f7fb',
    },
    '.cm-diagnostic': {
      fontFamily: 'var(--font-app-sans)',
      fontSize: '12px',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'linear-gradient(45deg, transparent 65%, #ff8b8b 80%, transparent 90%)',
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
      syntaxHighlighting(configHighlightStyle),
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
        doc: normalizeEditorValue(value),
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

    const nextValue = normalizeEditorValue(value);
    const current = view.state.doc.toString();
    if (current === nextValue) return;

    syncingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, insert: nextValue, to: view.state.doc.length },
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

function normalizeEditorValue(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/^\s+/, '');
}
