import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'jobibi_theme';

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>('light');

  useEffect(() => {
    let active = true;

    async function loadTheme() {
      try {
        const stored = await browser.storage.local.get(THEME_STORAGE_KEY);
        const val = stored[THEME_STORAGE_KEY];
        if (active && (val === 'light' || val === 'dark')) {
          setTheme(val);
          return;
        }
      } catch {
        if (typeof localStorage !== 'undefined') {
          const val = localStorage.getItem(THEME_STORAGE_KEY);
          if (active && (val === 'light' || val === 'dark')) {
            setTheme(val);
            return;
          }
        }
      }
    }

    void loadTheme();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      }
    }
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      void browser.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
    } catch {
      localStorage?.setItem(THEME_STORAGE_KEY, nextTheme);
    }
  };

  return { theme, toggleTheme, isDark: theme === 'dark' };
}
