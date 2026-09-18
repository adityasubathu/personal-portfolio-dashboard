import { createTheme, type MantineColorsTuple } from '@mantine/core'

const portfolioTeal: MantineColorsTuple = [
  '#e8f7f3', '#d3eee7', '#a9dccf', '#7bc8b5', '#54b59e',
  '#359f87', '#218b75', '#147362', '#0e5d50', '#0a4b41',
]

export const theme = createTheme({
  colors: { portfolioTeal },
  primaryColor: 'portfolioTeal',
  primaryShade: { light: 7, dark: 5 },
  defaultRadius: 'md',
  fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  headings: {
    fontFamily: 'inherit',
    fontWeight: '650',
    sizes: {
      h1: { lineHeight: '1.18' },
      h2: { lineHeight: '1.18' },
      h3: { lineHeight: '1.18' },
      h4: { lineHeight: '1.18' },
      h5: { lineHeight: '1.18' },
      h6: { lineHeight: '1.18' },
    },
  },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    ActionIcon: { defaultProps: { radius: 'md' } },
    Input: { defaultProps: { radius: 'md' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Tooltip: { defaultProps: { radius: 'md' } },
  },
})
