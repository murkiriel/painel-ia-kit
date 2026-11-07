// O recorte de acesso de um dashboard, quando ele tem um (UF, fazenda, unidade...): o que o administrador pode marcar por pessoa.
// Só tipos e funções de texto, sem enum nem classe, porque o servidor roda TypeScript por remoção de tipos e a tela usa o mesmo arquivo.
// Os textos concordam em gênero com o nome do recorte ("Todas as fazendas", "Todos os talhões").

export type ScopeLabel = {
  /** Como se chama um item, no singular ("fazenda", "talhão", "UF"). */
  singular: string;
  /** No plural ("fazendas", "talhões", "UFs"). */
  plural: string;
  /** "f" para "a fazenda", "m" para "o talhão". */
  gender: "f" | "m";
};

export type DashboardScope = {
  label: ScopeLabel;
  /** Os itens que o administrador pode marcar. O código é o que as consultas usam para a permissão, e não se repete. */
  items: { code: string; name: string }[];
};

const upperFirst = (text: string) => text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
const feminine = (label: ScopeLabel) => label.gender === "f";

/** "Todas as fazendas" ou "Todos os talhões". */
export const allOf = (label: ScopeLabel) => `${feminine(label) ? "Todas as" : "Todos os"} ${label.plural}`;

/** "estas fazendas" ou "estes talhões". */
export const these = (label: ScopeLabel) => `${feminine(label) ? "estas" : "estes"} ${label.plural}`;

/** "Só estas fazendas" ou "Só estes talhões". */
export const onlyThese = (label: ScopeLabel) => `Só ${these(label)}`;

/** "1 fazenda", "2 fazendas". */
export const countOf = (label: ScopeLabel, count: number) => `${count} ${count === 1 ? label.singular : label.plural}`;

/** "Escolha ao menos uma fazenda." ou "Escolha ao menos um talhão.". */
export const atLeastOne = (label: ScopeLabel) => `Escolha ao menos ${feminine(label) ? "uma" : "um"} ${label.singular}.`;

/** "Fazenda inválida." ou "Talhão inválido.". */
export const invalidItem = (label: ScopeLabel) => `${upperFirst(label.singular)} ${feminine(label) ? "inválida" : "inválido"}.`;

/** "nenhuma" ou "nenhum". */
export const noneOf = (label: ScopeLabel) => (feminine(label) ? "nenhuma" : "nenhum");

/** "outras" ou "outros". */
export const others = (label: ScopeLabel) => (feminine(label) ? "outras" : "outros");

/** "Fazendas de Exemplo", para o nome de um grupo na tela. */
export const groupOf = (label: ScopeLabel, dashboardName: string) => `${upperFirst(label.plural)} de ${dashboardName}`;
