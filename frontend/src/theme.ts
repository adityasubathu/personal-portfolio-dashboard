import { createTheme, type MantineColorsTuple } from '@mantine/core'

const portfolioBlue: MantineColorsTuple = [
  '#eef4ff', '#dbe6fb', '#b7cbf4', '#8dadea', '#6b93e2',
  '#5583dd', '#487adb', '#3a68c2', '#315cae', '#254e9a',
]

export const theme = createTheme({
  colors: { portfolioBlue },
  primaryColor: 'portfolioBlue',
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
