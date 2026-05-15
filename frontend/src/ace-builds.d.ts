declare module 'ace-builds/src-noconflict/ace' {
  export type AceEditor = {
    clearSelection(): void;
    destroy(): void;
    getValue(): string;
    on(event: 'change', callback: () => void): void;
    renderer: {
      setPadding(padding: number): void;
      setScrollMargin(top: number, bottom: number, left: number, right: number): void;
    };
    session: {
      setMode(mode: string): void;
      setUseWorker(useWorker: boolean): void;
      setUseWrapMode(useWrapMode: boolean): void;
    };
    setOption(name: string, value: unknown): void;
    setReadOnly(readOnly: boolean): void;
    setTheme(theme: string): void;
    setValue(value: string, cursorPosition?: number): void;
  };

  export function edit(element: HTMLElement, options?: Record<string, unknown>): AceEditor;
}

declare module 'ace-builds/src-noconflict/ext-searchbox';
declare module 'ace-builds/src-noconflict/mode-json';
declare module 'ace-builds/src-noconflict/theme-textmate';
declare module 'ace-builds/src-noconflict/theme-tomorrow_night';
