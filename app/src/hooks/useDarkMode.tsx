import { useState, useEffect } from 'react';

export type DarkModePreference = 'light' | 'dark' | 'system';

export function useDarkMode() {
  // Initialize from localStorage or default to 'system'
  const [preference, setPreference] = useState<DarkModePreference>(() => {
    try {
      const saved = localStorage.getItem('darkModePreference');
      return (saved as DarkModePreference) || 'system';
    } catch {
      return 'system';
    }
  });

  // Actual dark mode state (computed from preference + system)
  const [isDark, setIsDark] = useState(false);

  // Update localStorage when preference changes
  useEffect(() => {
    try {
      localStorage.setItem('darkModePreference', preference);
    } catch {
      // Ignore localStorage errors
    }
  }, [preference]);

  // Compute actual dark mode state
  useEffect(() => {
    if (preference === 'system') {
      // Listen for system preference changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleChange = (e: MediaQueryListEvent) => {
        setIsDark(e.matches);
      };

      // Set initial value
      setIsDark(mediaQuery.matches);

      // Listen for changes
      mediaQuery.addEventListener('change', handleChange);
      
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Use explicit preference
      setIsDark(preference === 'dark');
    }
  }, [preference]);

  return {
    isDark,
    preference,
    setPreference,
    // For backward compatibility
    darkMode: isDark,
    setDarkMode: (dark: boolean) => setPreference(dark ? 'dark' : 'light')
  };
}


