-- Para um portal.sqlite que já existe: acrescenta as categorias sem tocar em pessoas, sessões nem acessos. Pode ser repetido.
CREATE TABLE IF NOT EXISTS category (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL COLLATE NOCASE UNIQUE,
  position INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS dashboard_category (
  dashboard   TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES category (id) ON DELETE RESTRICT
) STRICT;
