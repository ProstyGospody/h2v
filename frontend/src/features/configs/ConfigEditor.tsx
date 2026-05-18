import { useEffect, useRef } from 'react';
import * as ace from 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/ext-searchbox';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-textmate';
import 'ace-builds/src-noconflict/theme-tomorrow_night';
import { cn } from '@/lib/utils';
import { useTheme } from '@/shared/theme/theme';

type ConfigEditorProps = {
  className?: string;
  label?: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  value: string;
};

const ACE_DARK_THEME = 'ace/theme/tomorrow_night';
const ACE_LIGHT_THEME = 'ace/theme/textmate';

export function ConfigEditor({
  className,
  label = 'Configuration editor',
  onChange,
  readOnly = false,
  value,
}: ConfigEditorProps) {
  const { theme } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<typeof ace.edit> | null>(null);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);
  const initialReadOnlyRef = useRef(readOnly);
  const initialThemeRef = useRef(theme);
  const initialValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const editor = ace.edit(host, {
      fontSize: 12,
      highlightActiveLine: true,
      highlightGutterLine: true,
      readOnly: initialReadOnlyRef.current,
      showPrintMargin: false,
      tabSize: 2,
      theme: initialThemeRef.current === 'dark' ? ACE_DARK_THEME : ACE_LIGHT_THEME,
      useSoftTabs: true,
      value: normalizeEditorValue(initialValueRef.current),
      wrap: true,
    });

    editor.session.setUseWorker(false);
    editor.session.setMode('ace/mode/json');
    editor.session.setUseWrapMode(true);
    editor.renderer.setPadding(0);
    editor.renderer.setScrollMargin(18, 28, 0, 0);
    editor.setOption('scrollPastEnd', 0.3);
    editor.setOption('showFoldWidgets', false);
    editor.setOption('displayIndentGuides', false);
    editor.setOption('fadeFoldWidgets', true);
    editor.resize(true);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => editor.resize());
    resizeObserver?.observe(host);
    editor.on('change', () => {
      if (!syncingRef.current) {
        onChangeRef.current(editor.getValue());
      }
    });
    editorRef.current = editor;

    return () => {
      resizeObserver?.disconnect();
      editor.destroy();
      host.textContent = '';
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.setTheme(theme === 'dark' ? ACE_DARK_THEME : ACE_LIGHT_THEME);
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.setReadOnly(readOnly);
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const nextValue = normalizeEditorValue(value);
    if (editor.getValue() === nextValue) return;

    syncingRef.current = true;
    try {
      editor.setValue(nextValue, -1);
      editor.clearSelection();
    } finally {
      syncingRef.current = false;
    }
  }, [value]);

  return (
    <div
      aria-label={label}
      className={cn(
        'config-editor h-full min-h-[360px] overflow-hidden rounded-md border border-border/65 bg-card shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]',
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
