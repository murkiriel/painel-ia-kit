// Administração do portal: pessoas, dashboards e o recorte de acesso de cada um, quando ele tem. Só o administrador chega aqui
// (o servidor confere antes), e toda escrita passa pela conexão do portal, que não enxerga os dados dos dashboards.
import { atLeastOne, invalidItem } from "../shared/scope.ts";
import { cleanedLogin, codesOf, grantedScope, hashPassword, loginIsValid, provisionalPassword } from "./auth.ts";
import type { Dashboard } from "./dashboard.ts";
import type { Db } from "./db/types.ts";
import { UNCATEGORIZED } from "./categories.ts";
import { BadRequest } from "./errors.ts";

export type AdminUser = {
  id: string;
  login: string;
  name: string;
  isAdmin: boolean;
  active: boolean;
  mustChangePassword: boolean;
  /** Por dashboard: acesso total ou a lista de códigos do recorte. Sem entrada, a pessoa não vê o dashboard. Num dashboard sem recorte, só há acesso total. */
  access: Record<string, { full: boolean; codes: string[] }>;
};

const MAX_NAME = 128;
const MAX_CATEGORY_NAME = 40;

export function createAdmin(portal: Db, dashboards: Dashboard[]) {
  const find = (slug: unknown) => {
    const dashboard = dashboards.find((d) => d.slug === slug);
    if (!dashboard) throw new BadRequest("Dashboard desconhecido.");
    return dashboard;
  };

  /** Pessoa existente e que não é administradora: o administrador não se desativa nem muda a própria senha por aqui. */
  async function ordinaryUser(id: unknown) {
    if (typeof id !== "string" || !/^\d{1,15}$/.test(id)) throw new BadRequest("Pessoa inválida.");
    const { rows } = await portal.query("SELECT id, is_admin FROM app_user WHERE id = $1", [id]);
    if (!rows[0]) throw new BadRequest("Pessoa inválida.");
    if (rows[0].is_admin) throw new BadRequest("O administrador não é alterado por esta tela.");
    return id;
  }

  async function existingCategory(id: unknown) {
    if (typeof id !== "string" || !/^\d{1,15}$/.test(id)) throw new BadRequest("Categoria inválida.");
    if ((await portal.query("SELECT 1 FROM category WHERE id = $1", [id])).rows.length === 0) throw new BadRequest("Categoria inválida.");
    return id;
  }

  async function categoryName(name: unknown, own: string | null): Promise<string> {
    if (typeof name !== "string") throw new BadRequest("Informe o nome da categoria.");
    const clean = name.normalize("NFC").trim();
    if (clean === "" || clean.length > MAX_CATEGORY_NAME || /\p{Cc}/u.test(clean)) throw new BadRequest(`O nome da categoria precisa ter de 1 a ${MAX_CATEGORY_NAME} caracteres, sem caracteres de controle.`);
    if (clean.toLocaleLowerCase("pt-BR") === UNCATEGORIZED.toLocaleLowerCase("pt-BR")) throw new BadRequest(`"${UNCATEGORIZED}" é o nome da seção dos dashboards sem categoria.`);
    // A comparação é feita aqui: o lower() do banco só entende ASCII em um Postgres com a configuração C, e "PRODUÇÃO" não igualaria "Produção".
    const { rows } = await portal.query("SELECT id, name FROM category");
    if (rows.some((r) => String(r.id) !== own && String(r.name).toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"))) throw new BadRequest("Já existe uma categoria com este nome.");
    return clean;
  }

  /** A senha provisória fica só em hash: quem a cria a vê uma vez, na resposta. */
  const provisional = () => {
    const password = provisionalPassword();
    return { password, ...hashPassword(password) };
  };

  return {
    /** Os dashboards do projeto, o recorte (ou nulo) e a categoria de cada um, mais as categorias na ordem definida, para a tela de administração. */
    async catalog() {
      const [categories, assigned] = await Promise.all([
        portal.query("SELECT id, name FROM category ORDER BY position, id"),
        portal.query("SELECT dashboard, category_id FROM dashboard_category"),
      ]);
      const categoryOf = Object.fromEntries(assigned.rows.map((r) => [String(r.dashboard), String(r.category_id)]));
      const known = new Set(categories.rows.map((r) => String(r.id)));
      return {
        dashboards: dashboards.map((d) => ({ slug: d.slug, name: d.card.name, scope: d.scope ?? null, categoryId: known.has(categoryOf[d.slug] ?? "") ? categoryOf[d.slug] : null })),
        categories: categories.rows.map((r) => ({ id: String(r.id), name: String(r.name) })),
      };
    },

    /** Nome da categoria: sem espaços nas pontas, de 1 a 40 caracteres, sem caractere de controle, único sem diferenciar maiúscula, e nunca o de "Sem categoria". */
    async createCategory(name: unknown): Promise<{ id: string }> {
      const clean = await categoryName(name, null);
      const { rows } = await portal.query("INSERT INTO category (name, position) VALUES ($1, (SELECT coalesce(max(position), 0) + 1 FROM category)) RETURNING id", [clean]);
      return { id: String(rows[0].id) };
    },

    async renameCategory(id: unknown, name: unknown): Promise<void> {
      const categoryId = await existingCategory(id);
      const clean = await categoryName(name, categoryId);
      await portal.query("UPDATE category SET name = $2 WHERE id = $1", [categoryId, clean]);
    },

    /** Sobe ou desce uma posição, trocando com a vizinha. */
    async moveCategory(id: unknown, direction: unknown): Promise<void> {
      const categoryId = await existingCategory(id);
      if (direction !== "up" && direction !== "down") throw new BadRequest("Direção inválida.");
      const { rows } = await portal.query("SELECT id, position FROM category ORDER BY position, id");
      const list = rows.map((r) => ({ id: String(r.id), position: Number(r.position) }));
      const at = list.findIndex((c) => c.id === categoryId);
      const other = list[direction === "up" ? at - 1 : at + 1];
      if (!other) return;
      // Uma instrução só: as duas posições trocam juntas. Se estavam empatadas, a troca as separa.
      const [mine, theirs] = list[at].position === other.position ? [other.position + (direction === "up" ? -1 : 1), other.position] : [other.position, list[at].position];
      await portal.query("UPDATE category SET position = CASE id WHEN $1 THEN $3::int WHEN $2 THEN $4::int END WHERE id IN ($1, $2)", [categoryId, other.id, mine, theirs]);
    },

    /** Só se apaga categoria vazia: nenhum dashboard perde a categoria sem a pessoa ver. */
    async deleteCategory(id: unknown): Promise<void> {
      const categoryId = await existingCategory(id);
      const removed = await portal.query("DELETE FROM category WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM dashboard_category WHERE category_id = $1) RETURNING id", [categoryId]);
      if (removed.rows.length === 0) throw new BadRequest("Só é possível apagar uma categoria sem dashboards. Mude os dashboards dela para outra categoria antes.");
    },

    /** Muda a categoria de um dashboard. Sem categoria (nulo), ele vai para "Sem categoria". Não muda o acesso de ninguém. */
    async setDashboardCategory(slug: unknown, categoryId: unknown): Promise<void> {
      const dashboard = find(slug);
      if (categoryId === null) {
        await portal.query("DELETE FROM dashboard_category WHERE dashboard = $1", [dashboard.slug]);
        return;
      }
      const id = await existingCategory(categoryId);
      await portal.query("INSERT INTO dashboard_category (dashboard, category_id) VALUES ($1, $2) ON CONFLICT (dashboard) DO UPDATE SET category_id = $2", [dashboard.slug, id]);
    },

    /**
     * Atalho: "all" dá acesso total a cada dashboard da categoria, gravando um acesso por dashboard, como a tela de uma pessoa faz;
     * "none" tira os acessos a esses dashboards. O recorte continua só por dashboard, e um dashboard que entrar na categoria
     * depois não aparece sozinho para ninguém.
     */
    async setCategoryAccess(userId: unknown, categoryId: unknown, mode: unknown): Promise<void> {
      const id = await ordinaryUser(userId);
      const category = await existingCategory(categoryId);
      if (mode !== "all" && mode !== "none") throw new BadRequest("Informe se a pessoa fica com todos os dashboards da categoria ou com nenhum.");
      const { rows } = await portal.query("SELECT dashboard FROM dashboard_category WHERE category_id = $1", [category]);
      for (const slug of rows.map((r) => String(r.dashboard)).filter((name) => dashboards.some((d) => d.slug === name))) {
        await this.setAccess(id, slug, mode, []);
      }
    },

    async users(): Promise<AdminUser[]> {
      const { rows } = await portal.query("SELECT id, login, name, is_admin, active, must_change_password FROM app_user ORDER BY login");
      const access = await portal.query("SELECT user_id, dashboard, full_access, state_codes FROM dashboard_access");
      return rows.map((r) => ({
        id: String(r.id),
        login: r.login,
        name: r.name,
        isAdmin: Boolean(r.is_admin),
        active: Boolean(r.active),
        mustChangePassword: Boolean(r.must_change_password),
        // Dashboard que saiu do projeto não aparece, mas a linha continua guardada. A mesma regra do servidor decide o que vale:
        // uma linha parcial de um dashboard sem recorte não dá acesso, e a administração mostra "Sem acesso".
        access: Object.fromEntries(
          access.rows
            .filter((a) => String(a.user_id) === String(r.id))
            .flatMap((a) => {
              const dashboard = dashboards.find((d) => d.slug === a.dashboard);
              const full = Boolean(a.full_access);
              const granted = dashboard && grantedScope(dashboard, { full, codes: codesOf(a.state_codes) });
              return dashboard && granted ? [[dashboard.slug, { full, codes: full ? [] : granted }] as const] : [];
            }),
        ),
      }));
    },

    /** Cria a pessoa sem nenhum dashboard e com senha provisória. Devolve a senha, que não fica guardada em lugar nenhum. */
    async createUser(login: unknown, name: unknown): Promise<{ id: string; password: string }> {
      if (typeof login !== "string") throw new BadRequest("Informe o usuário.");
      const clean = cleanedLogin(login);
      if (!loginIsValid(clean)) throw new BadRequest("No usuário, use letras, números e . _ @ -.");
      const shown = typeof name === "string" && name.trim() !== "" ? name.trim().normalize("NFC") : clean;
      if (shown.length > MAX_NAME || /\p{Cc}/u.test(shown)) throw new BadRequest("Nome inválido.");
      if ((await portal.query("SELECT 1 FROM app_user WHERE login = $1", [clean])).rows.length > 0) throw new BadRequest("Já existe uma pessoa com este usuário.");
      const { password, hash, salt } = provisional();
      const { rows } = await portal.query(
        "INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin, active, must_change_password) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [clean, shown, hash, salt, false, true, true],
      );
      return { id: String(rows[0].id), password };
    },

    /**
     * Define o acesso a um dashboard: "none" tira, "all" dá tudo, "some" dá só os itens do recorte listados.
     * A lista precisa ter ao menos um item do recorte do dashboard. Um dashboard sem recorte só aceita "none" e "all".
     */
    async setAccess(userId: unknown, slug: unknown, mode: unknown, codes: unknown): Promise<void> {
      const id = await ordinaryUser(userId);
      const dashboard = find(slug);
      if (mode === "none") {
        await portal.query("DELETE FROM dashboard_access WHERE user_id = $1 AND dashboard = $2", [id, dashboard.slug]);
        return;
      }
      if (mode === "all") {
        await portal.query(
          "INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, dashboard) DO UPDATE SET full_access = $3, state_codes = $4",
          [id, dashboard.slug, true, []],
        );
        return;
      }
      const { scope } = dashboard;
      if (!scope) throw new BadRequest("Este dashboard não tem recorte: escolha com ou sem acesso.");
      if (mode !== "some" || !Array.isArray(codes) || codes.length === 0 || codes.some((code) => typeof code !== "string")) throw new BadRequest(atLeastOne(scope.label));
      const known = new Set(scope.items.map((item) => item.code));
      if (codes.some((code) => !known.has(code))) throw new BadRequest(invalidItem(scope.label));
      await portal.query(
        "INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, dashboard) DO UPDATE SET full_access = $3, state_codes = $4",
        [id, dashboard.slug, false, [...new Set(codes as string[])].sort()],
      );
    },

    /** Desativar derruba as sessões. Reativar devolve o acesso que a pessoa tinha. */
    async setActive(userId: unknown, active: unknown): Promise<void> {
      const id = await ordinaryUser(userId);
      if (typeof active !== "boolean") throw new BadRequest("Informe se a pessoa fica ativa.");
      await portal.query("UPDATE app_user SET active = $2 WHERE id = $1", [id, active]);
      if (!active) await portal.query("DELETE FROM app_session WHERE user_id = $1", [id]);
    },

    /** Nova senha provisória: a antiga deixa de valer, as sessões caem e a pessoa precisa trocá-la ao entrar. */
    async resetPassword(userId: unknown): Promise<{ password: string }> {
      const id = await ordinaryUser(userId);
      const { password, hash, salt } = provisional();
      await portal.query("UPDATE app_user SET pass_hash = $2, pass_salt = $3, must_change_password = $4 WHERE id = $1", [id, hash, salt, true]);
      await portal.query("DELETE FROM app_session WHERE user_id = $1", [id]);
      return { password };
    },
  };
}

export type Admin = ReturnType<typeof createAdmin>;
