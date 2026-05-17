import { createContext, PropsWithChildren, useContext, useMemo } from 'react';
import { colors, ThemeColors } from './colors';

type ThemeMode = 'dark';

type DopaTheme = {
  mode: ThemeMode;
  colors: ThemeColors;
};

const ThemeContext = createContext<DopaTheme | null>(null);

export function DopaThemeProvider({ children }: PropsWithChildren) {
  const value = useMemo<DopaTheme>(
    () => ({
      mode: 'dark',
      colors,
    }),
    [],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useDopaTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useDopaTheme must be used inside DopaThemeProvider');
  }
  return theme;
}
