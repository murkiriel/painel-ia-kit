-- As mesmas tabelas de portal_schema.sql, para o SQLite. Datas em texto ISO, em UTC, sempre com o mesmo formato.
CREATE TABLE app_user (
  id         INTEGER PRIMARY KEY,
  login      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  pass_salt  TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE app_session (
  token      TEXT PRIMARY KEY,
  csrf       TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE dashboard_access (
  user_id     INTEGER NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  dashboard   TEXT NOT NULL,
  full_access INTEGER NOT NULL DEFAULT 0,
  -- Os códigos do recorte do dashboard (estado, fazenda, unidade...), em JSON. O nome da coluna vem da primeira versão.
  -- Dashboard sem recorte só vale com full_access: uma lista aqui não dá acesso a ele.
  state_codes TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, dashboard)
) STRICT;

-- Categorias de dashboards, como no Postgres. Nome único sem diferenciar maiúscula de minúscula.
CREATE TABLE category (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL COLLATE NOCASE UNIQUE,
  position INTEGER NOT NULL
) STRICT;

CREATE TABLE dashboard_category (
  dashboard   TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES category (id) ON DELETE RESTRICT
) STRICT;
