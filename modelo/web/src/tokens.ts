// Os gráficos e as tabelas usam estes valores, sem cor solta.
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const readTokens = () => ({
  primary: css("--color-primary"),
  negative: css("--color-negative"),
  text: css("--color-text"),
  muted: css("--color-text-muted"),
  grid: css("--color-grid"),
  surface: css("--color-surface"),
  background: css("--color-background"),
  series: [1, 2, 3, 4, 5, 6].map((i) => css(`--chart-${i}`)),
});

export type Tokens = ReturnType<typeof readTokens>;
