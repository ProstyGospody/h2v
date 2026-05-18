import { useEffect, useRef } from 'react';
import * as ace from 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/ext-searchbox';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-textmate';
import 'ace-builds/src-noconflict/theme-tomorrow_night';
import { cn } from '@/lib/utils';
import { useTheme } from '@/shared/theme/theme';

type ConfigEditorProps = {
  autoFold?: 'xray-clients';
  className?: string;
  label?: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  value: string;
};

const ACE_DARK_THEME = 'ace/theme/tomorrow_night';
const ACE_LIGHT_THEME = 'ace/theme/textmate';

export function ConfigEditor({
  autoFold,
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
  const initialAutoFoldRef = useRef(autoFold);

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
    applyAutoFold(editor, initialAutoFoldRef.current);
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

    applyAutoFold(editor, autoFold);
  }, [autoFold, value]);

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
    applyAutoFold(editor, autoFold);
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

function applyAutoFold(editor: ReturnType<typeof ace.edit>, autoFold: ConfigEditorProps['autoFold']) {
  if (autoFold !== 'xray-clients') return;

  const foldRange = findXrayClientsFoldRange(editor.getValue());
  if (!foldRange) return;

  try {
    const AceRange = (ace as unknown as { require: (module: string) => { Range: new (...args: number[]) => unknown } })
      .require('ace/range')
      .Range;
    const session = editor.session as unknown as { addFold: (placeholder: string, range: unknown) => unknown };
    session.addFold(
      `... ${foldRange.clientCount} clients ...`,
      new AceRange(foldRange.startRow, foldRange.startColumn, foldRange.endRow, foldRange.endColumn),
    );
  } catch {
    // The range can already be folded after resize/theme/value sync.
  }
}

function findXrayClientsFoldRange(value: string) {
  const lines = value.split('\n');
  const clientsRow = lines.findIndex((line) => /"clients"\s*:\s*\[/.test(line));
  if (clientsRow < 0) return null;

  let depth = 0;
  let foundOpen = false;
  for (let row = clientsRow; row < lines.length; row += 1) {
    for (const char of lines[row] ?? '') {
      if (char === '[') {
        depth += 1;
        foundOpen = true;
      } else if (char === ']') {
        depth -= 1;
      }
    }

    if (foundOpen && depth === 0) {
      const startRow = clientsRow + 1;
      const endRow = row - 1;
      if (endRow <= startRow) return null;

      return {
        clientCount: Math.max(0, lines.slice(startRow, endRow + 1).filter((line) => /"id"\s*:/.test(line)).length),
        endColumn: lines[endRow]?.length ?? 0,
        endRow,
        startColumn: lines[startRow]?.match(/^\s*/)?.[0].length ?? 0,
        startRow,
      };
    }
  }

  return null;
}
