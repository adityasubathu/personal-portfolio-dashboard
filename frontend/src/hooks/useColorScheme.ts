import { useMediaQuery } from './useMediaQuery'

export function useColorScheme(): 'light' | 'dark' {
  return useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light'
}
