import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

type Theme = 'dark' | 'light';

type ThemeContextValue = {
  setTheme: (theme: Theme) => void;
  theme: Theme;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = 'h2v-theme';
const THEME_SWITCHING_CLASS = 'theme-switching';

const ThemeContext = createContext<ThemeContextValue | null>(null);
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';

  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme, disableTransitions = false) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (disableTransitions) {
    root.classList.add(THEME_SWITCHING_CLASS);
  }

  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;

  if (disableTransitions && typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        root.classList.remove(THEME_SWITCHING_CLASS);
      });
    });
  }
}

function persistTheme(theme: Theme) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
  }
}

function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState((current) => (current === nextTheme ? current : nextTheme));
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  useIsomorphicLayoutEffect(() => {
    applyTheme(theme, true);
    persistTheme(theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      setTheme,
      theme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider.');
  }

  return context;
}

export { ThemeProvider, useTheme };
export type { Theme };
