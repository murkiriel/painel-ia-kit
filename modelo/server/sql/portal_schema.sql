-- O portal: quem entra e o que cada pessoa vê. Roda com o schema "portal" como search_path (npm run db).
CREATE TABLE app_user (
  id         BIGSERIAL PRIMARY KEY,
  login      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  pass_salt  TEXT NOT NULL,
  -- Administrador vê todos os dashboards, inteiros, e abre a tela de administração. O perfil é explícito.
  is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Desativar impede de entrar e derruba as sessões, sem apagar a pessoa.
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Senha provisória: a pessoa só consegue trocá-la, até escolher a sua.
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_session (
  token      TEXT PRIMARY KEY,
  csrf       TEXT NOT NULL,
  user_id    BIGINT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Um dashboard por linha. Acesso total é o perfil explícito, nunca lista nula. Sem linha, a pessoa não vê o dashboard.
CREATE TABLE dashboard_access (
  user_id     BIGINT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  dashboard   TEXT NOT NULL,
  full_access BOOLEAN NOT NULL DEFAULT FALSE,
  -- Os códigos do recorte do dashboard (estado, fazenda, unidade...), quando ele tem um. O nome da coluna vem da primeira versão.
  -- Dashboard sem recorte só vale com full_access: uma lista aqui não dá acesso a ele.
  state_codes TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, dashboard)
);

-- Categorias de dashboards: o administrador cria, renomeia, ordena e apaga, e escolhe a de cada dashboard na tela de administração.
-- Dashboard sem linha em dashboard_category aparece em "Sem categoria", por último. Categoria só se apaga vazia.
CREATE TABLE category (
  id       BIGSERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE UNIQUE INDEX category_name_unique ON category (lower(name));

CREATE TABLE dashboard_category (
  dashboard   TEXT PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES category (id) ON DELETE RESTRICT
);
