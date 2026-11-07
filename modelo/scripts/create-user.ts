// Cria uma pessoa no portal, de fora do navegador (por exemplo, em produção, sem a tela de administração aberta).
//
//   NEW_USER_PASSWORD=... node scripts/create-user.ts [--admin] <login> "<Nome>" [<dashboard> | <dashboard>:todas | <dashboard>:<código,código> ...]
//
// Dashboard sem recorte: só o nome (ou :todas). Dashboard com recorte (estado, fazenda...): :todas (ou :todos) ou a lista de códigos dele.
// Exemplo: NEW_USER_PASSWORD=... node scripts/create-user.ts maria "Maria" producao-agricola:51,35 outro-dashboard
// A senha vem do ambiente, para não ficar no histórico. Quem entra com ela é levado a trocá-la, a menos que seja --admin.
// O dia a dia (criar, marcar dashboards e o recorte de cada um, desativar) é pela tela de administração do portal.
import { existsSync } from "node:fs";
import { hashPassword, cleanedLogin, loginIsValid, passwordIsInvalid } from "../server/auth.ts";
import { validateDashboards } from "../server/dashboard.ts";
import { DASHBOARDS } from "../server/dashboards.ts";
import { openAdmin } from "../server/db/open.ts";
import { parseAccessArgs } from "./lib/access-args.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const args = process.argv.slice(2);
const isAdmin = args.includes("--admin");
const [login, name, ...accessArgs] = args.filter((arg) => arg !== "--admin");
const password = process.env.NEW_USER_PASSWORD;

const usage = 'Uso: NEW_USER_PASSWORD=... node scripts/create-user.ts [--admin] login "Nome" [dashboard | dashboard:todas | dashboard:cod,cod ...]';
if (!login || !name || !password) {
  console.error(usage);
  process.exit(1);
}
const clean = cleanedLogin(login);
if (!loginIsValid(clean) || passwordIsInvalid(password, clean)) {
  console.error("Usuário com letras, números e . _ @ -. Senha com pelo menos 8 caracteres, diferente do usuário.");
  process.exit(1);
}

validateDashboards(DASHBOARDS);
const parsed = parseAccessArgs(DASHBOARDS, accessArgs);
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(1);
}
const access = parsed.grants;

const { hash, salt } = hashPassword(password);
const portal = await openAdmin("portal");
try {
  const { rows } = await portal.query(
    "INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin, active, must_change_password) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [clean, name, hash, salt, isAdmin, true, !isAdmin],
  );
  for (const item of access) {
    await portal.query("INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, $2, $3, $4)", [rows[0].id, item.slug, item.full, item.codes]);
  }
} finally {
  await portal.end();
}
console.log(`${isAdmin ? "Administrador" : "Pessoa"} ${clean} criada${isAdmin ? "" : ", com senha provisória (a troca é pedida no primeiro acesso)"}.`);
