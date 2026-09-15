import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Moon, Sun } from 'lucide-react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'asse_theme_v1';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
});

function readInitialTheme(): ThemeMode {
  return 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = useState<ThemeMode>('light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    try {
      localStorage.setItem(STORAGE_KEY, 'light');
    } catch {
      /* ignore */
    }
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]:not([media])'
    );
    if (meta) meta.content = '#f2f3f5';
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState('light');
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState('light');
  }, []);

  const value = useMemo(
    () => ({ theme: 'light' as ThemeMode, setTheme, toggleTheme }),
    [setTheme, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

export const ThemeToggle: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-text-2 transition-colors duration-200 hover:border-line-strong hover:text-text ${className}`}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" strokeWidth={2} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );
};
