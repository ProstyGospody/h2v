import { useEffect, useMemo, useRef } from 'react';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { minimalSetup } from 'codemirror';
import { cn } from '@/lib/utils';
import { useTheme } from '@/shared/theme/theme';

type ConfigEditorProps = {
  className?: string;
  label?: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  value: string;
};

const configHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'hsl(var(--syntax-property))', fontWeight: '500' },
  { tag: tags.string, color: 'hsl(var(--syntax-string))' },
  { tag: [tags.number, tags.integer, tags.float], color: 'hsl(var(--syntax-number))' },
  { tag: [tags.bool, tags.null, tags.atom], color: 'hsl(var(--syntax-atom))' },
  { tag: tags.keyword, color: 'hsl(var(--syntax-keyword))' },
  { tag: tags.operator, color: 'hsl(var(--syntax-operator))' },
  { tag: [tags.punctuation, tags.separator], color: 'hsl(var(--syntax-punctuation))' },
  { tag: tags.bracket, color: 'hsl(var(--syntax-bracket))' },
  { tag: tags.comment, color: 'hsl(var(--syntax-comment))', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'hsl(var(--syntax-invalid))', textDecoration: 'none' },
]);

const configEditorSetup: Extension = [
  minimalSetup,
  lineNumbers(),
  highlightActiveLineGutter(),
  bracketMatching(),
  highlightActiveLine(),
];

function createConfigEditorTheme(dark: boolean): Extension {
  return EditorView.theme(
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
        lineHeight: '1.62',
        padding: '18px 0',
      },
      '.cm-content': {
        caretColor: 'hsl(var(--ring))',
        minHeight: '100%',
        padding: '0',
      },
      '.cm-line': {
        padding: '0 20px',
      },
      '.cm-gutters': {
        backgroundColor: 'hsl(var(--card))',
        borderRight: '1px solid hsl(var(--border) / 0.55)',
        color: 'hsl(var(--muted-foreground))',
      },
      '.cm-gutterElement': {
        lineHeight: '1.62',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        minWidth: '44px',
        padding: '0 12px 0 16px',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'hsl(var(--ring) / 0.08)',
      },
      '.cm-activeLineGutter': {
        color: 'hsl(var(--foreground))',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'hsl(var(--ring) / 0.28) !important',
      },
      '.cm-selectionMatch': {
        backgroundColor: 'hsl(var(--ring) / 0.16)',
      },
      '.cm-cursor': {
        borderLeftColor: 'hsl(var(--ring))',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'hsl(var(--success) / 0.14)',
        outline: '1px solid hsl(var(--success) / 0.34)',
      },
      '.cm-nonmatchingBracket': {
        backgroundColor: 'hsl(var(--destructive) / 0.14)',
        outline: '1px solid hsl(var(--destructive) / 0.34)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'hsl(var(--warning) / 0.22)',
        outline: '1px solid hsl(var(--warning) / 0.28)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'hsl(var(--ring) / 0.26)',
      },
      '.cm-panels': {
        backgroundColor: 'hsl(var(--popover))',
        borderColor: 'hsl(var(--border) / 0.85)',
        color: 'hsl(var(--popover-foreground))',
      },
      '.cm-textfield': {
        backgroundColor: 'hsl(var(--input))',
        border: '1px solid hsl(var(--border) / 0.85)',
        borderRadius: '6px',
        color: 'hsl(var(--foreground))',
        fontFamily: 'var(--font-app-mono)',
        padding: '2px 7px',
      },
      '.cm-button': {
        backgroundColor: 'hsl(var(--secondary))',
        backgroundImage: 'none',
        border: '1px solid hsl(var(--border) / 0.85)',
        borderRadius: '6px',
        color: 'hsl(var(--secondary-foreground))',
        fontFamily: 'var(--font-app-sans)',
        padding: '2px 8px',
      },
      '.cm-tooltip': {
        backgroundColor: 'hsl(var(--popover))',
        border: '1px solid hsl(var(--border) / 0.85)',
        borderRadius: '8px',
        color: 'hsl(var(--popover-foreground))',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'hsl(var(--ring) / 0.18)',
        color: 'hsl(var(--foreground))',
      },
      '.cm-diagnostic': {
        fontFamily: 'var(--font-app-sans)',
        fontSize: '12px',
      },
      '.cm-lintRange-error': {
        backgroundImage: 'linear-gradient(45deg, transparent 65%, hsl(var(--destructive)) 80%, transparent 90%)',
      },
    },
    { dark },
  );
}

export function ConfigEditor({
  className,
  label = 'Configuration editor',
  onChange,
  readOnly = false,
  value,
}: ConfigEditorProps) {
  const { theme } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);
  const initialReadOnlyRef = useRef(readOnly);
  const initialThemeRef = useRef(theme);
  const themeCompartmentRef = useRef<Compartment | null>(null);
  const readOnlyCompartmentRef = useRef<Compartment | null>(null);
  const editableCompartmentRef = useRef<Compartment | null>(null);
  const initialValueRef = useRef(value);

  if (!themeCompartmentRef.current) themeCompartmentRef.current = new Compartment();
  if (!readOnlyCompartmentRef.current) readOnlyCompartmentRef.current = new Compartment();
  if (!editableCompartmentRef.current) editableCompartmentRef.current = new Compartment();

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const extensions = useMemo<Extension[]>(
    () => [
      configEditorSetup,
      json(),
      syntaxHighlighting(configHighlightStyle),
      lintGutter(),
      linter(jsonParseLinter(), { delay: 250 }),
      EditorView.lineWrapping,
      themeCompartmentRef.current!.of(createConfigEditorTheme(initialThemeRef.current === 'dark')),
      readOnlyCompartmentRef.current!.of(EditorState.readOnly.of(initialReadOnlyRef.current)),
      editableCompartmentRef.current!.of(EditorView.editable.of(!initialReadOnlyRef.current)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !syncingRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ],
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: normalizeEditorValue(initialValueRef.current),
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

    view.dispatch({
      effects: themeCompartmentRef.current!.reconfigure(createConfigEditorTheme(theme === 'dark')),
    });
  }, [theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: [
        readOnlyCompartmentRef.current!.reconfigure(EditorState.readOnly.of(readOnly)),
        editableCompartmentRef.current!.reconfigure(EditorView.editable.of(!readOnly)),
      ],
    });
  }, [readOnly]);

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
