// Erros que viram resposta HTTP. Os dashboards lançam estes; o servidor traduz.
/** Pedido inválido (400): a mensagem é para a pessoa e vai na resposta. */
export class BadRequest extends Error {}
/** Sem permissão (403). */
export class Forbidden extends Error {}
