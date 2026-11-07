// Lê os acessos que o create-user recebe na linha de comando: "dashboard" (sem recorte), "dashboard:todas" ou "dashboard:todos"
// (acesso total) e "dashboard:cod,cod" (só estes itens do recorte). A regra de permissão é a do servidor: aqui só se traduz o texto.
import { atLeastOne, invalidItem } from "../../shared/scope.ts";
import type { Dashboard } from "../../server/dashboard.ts";

export type AccessGrant = { slug: string; full: boolean; codes: string[] };

/** Devolve os acessos, ou a mensagem do primeiro problema. Código repetido conta uma vez só. */
export function parseAccessArgs(dashboards: Pick<Dashboard, "slug" | "scope">[], args: string[]): { grants: AccessGrant[] } | { error: string } {
  const grants: AccessGrant[] = [];
  for (const item of args) {
    const split = item.indexOf(":");
    const slug = split < 0 ? item : item.slice(0, split);
    const list = split < 0 ? null : item.slice(split + 1);
    const dashboard = dashboards.find((d) => d.slug === slug);
    if (!dashboard) return { error: `Dashboard desconhecido: ${slug}. Os do projeto: ${dashboards.map((d) => d.slug).join(", ")}.` };
    if (grants.some((grant) => grant.slug === slug)) return { error: `Dashboard repetido: ${slug}.` };
    const { scope } = dashboard;
    if (!scope) {
      // Sem recorte: "com acesso" é o dashboard puro (ou com todas/todos), e uma lista de códigos não tem o que filtrar.
      if (list !== null && list !== "todas" && list !== "todos") return { error: `${slug} não tem recorte: use só ${slug} (ou ${slug}:todas).` };
      grants.push({ slug, full: true, codes: [] });
      continue;
    }
    if (list === null) return { error: `${slug} tem recorte: use ${slug}:todas ou ${slug}:${scope.items.slice(0, 2).map((i) => i.code).join(",")}.` };
    if (list === "todas" || list === "todos") {
      grants.push({ slug, full: true, codes: [] });
      continue;
    }
    const codes = [...new Set(list.split(",").filter(Boolean))];
    if (codes.length === 0) return { error: `${atLeastOne(scope.label)} Use ${slug}:todas ou códigos como ${scope.items.slice(0, 2).map((i) => i.code).join(",")}.` };
    const known = new Set(scope.items.map((i) => i.code));
    const unknown = codes.filter((code) => !known.has(code));
    if (unknown.length > 0) return { error: `${invalidItem(scope.label)} (${unknown.join(", ")}) Use ${slug}:todas ou códigos como ${scope.items.slice(0, 2).map((i) => i.code).join(",")}.` };
    grants.push({ slug, full: false, codes: codes.sort() });
  }
  return { grants };
}
