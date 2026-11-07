// Regras de tela comuns aos dashboards, sem React nem navegador: dá para testar direto.

/** O que oferecer quando um bloco falha. Tentar de novo só aparece quando pode resolver. */
export function failureAction(failure: { invalidLink: boolean; unpublished?: boolean; forbidden?: boolean }): "retry" | "home" {
  return failure.invalidLink || failure.unpublished || failure.forbidden ? "home" : "retry";
}
