-- As mesmas tabelas de 001_schema.sql, para o SQLite. STRICT recusa tipo errado, em vez de converter em silêncio.
-- Dinheiro, quantidade e área em inteiro: a escala de cada coluna fica em numeric_scale, e o texto sai com essas casas.
CREATE TABLE numeric_scale (
  column_name TEXT PRIMARY KEY,
  scale       INTEGER NOT NULL
) STRICT;
INSERT INTO numeric_scale VALUES ('value_brl', 2), ('quantity_t', 3), ('area_ha', 3);

-- Camada bruta: o valor como veio da fonte, inclusive os símbolos.
CREATE TABLE raw_production (
  year        INTEGER NOT NULL,
  state_code  TEXT NOT NULL,
  state_name  TEXT NOT NULL,
  variable    TEXT NOT NULL,
  unit        TEXT NOT NULL,
  crop_code   TEXT NOT NULL,
  crop_name   TEXT NOT NULL,
  raw_value   TEXT NOT NULL,
  PRIMARY KEY (year, state_code, variable, crop_code)
) STRICT;

-- Camada tratada: uma linha por ano, estado e lavoura. O valor em R$ já convertido de mil reais.
CREATE TABLE production (
  year        INTEGER NOT NULL,
  state_code  TEXT NOT NULL,
  state_name  TEXT NOT NULL,
  region      TEXT NOT NULL,
  crop_code   TEXT NOT NULL,
  crop_name   TEXT NOT NULL,
  value_brl   INTEGER,
  quantity_t  INTEGER,
  -- A fonte marca algumas lavouras com asterisco, e a nota ainda não foi confirmada.
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('t', 'a verificar')),
  area_ha     INTEGER,
  PRIMARY KEY (year, state_code, crop_code)
) STRICT;
CREATE INDEX production_filters ON production (year, region, state_code, crop_code);

-- Totais do Brasil publicados pela fonte, por lavoura. Não entram nas somas: servem para a conferência.
CREATE TABLE source_national (
  year        INTEGER NOT NULL,
  crop_code   TEXT NOT NULL,
  value_brl   INTEGER,
  quantity_t  INTEGER,
  area_ha     INTEGER,
  PRIMARY KEY (year, crop_code)
) STRICT;

-- Datas em texto ISO, em UTC, sempre com o mesmo formato: assim, comparar texto é comparar data.
CREATE TABLE load_log (
  id            INTEGER PRIMARY KEY,
  entity        TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  rows_read     INTEGER,
  rows_saved    INTEGER,
  rows_rejected INTEGER,
  error         TEXT
) STRICT;
