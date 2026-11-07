-- Para um banco do portal que já existe: acrescenta as categorias sem tocar em pessoas, sessões nem acessos.
-- Roda com o schema "portal" como search_path (npm run db faz isso quando as tabelas faltam) e pode ser repetido.
CREATE TABLE IF NOT EXISTS category (
  id       BIGSERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS category_name_unique ON category (lower(name));

CREATE TABLE IF NOT EXISTS dashboard_category (
  dashboard   TEXT PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES category (id) ON DELETE RESTRICT
);

GRANT SELECT ON category, dashboard_category TO dash_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON category, dashboard_category TO dash_portal;
GRANT USAGE ON SEQUENCE category_id_seq TO dash_portal;
