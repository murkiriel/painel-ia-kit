/** Verdadeiro só no site estático: vira uma constante na hora de gerar o pacote. */
declare const __STATIC_SITE__: boolean;
/** O dashboard de um site estático (cada site leva um só). Vazio fora dele. */
declare const __STATIC_DASHBOARD__: string;

declare module "echarts/lib/i18n/langPT-br.js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locale: any;
  export default locale;
}
