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
);

-- Camada tratada: uma linha por ano, estado e lavoura. O valor em R$ já convertido de mil reais.
CREATE TABLE production (
  year        INTEGER NOT NULL,
  state_code  TEXT NOT NULL,
  state_name  TEXT NOT NULL,
  region      TEXT NOT NULL,
  crop_code   TEXT NOT NULL,
  crop_name   TEXT NOT NULL,
  value_brl   NUMERIC(20, 2),
  quantity_t  NUMERIC(20, 3),
  -- A fonte marca algumas lavouras com asterisco, e a nota ainda não foi confirmada.
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('t', 'a verificar')),
  area_ha     NUMERIC(20, 3),
  PRIMARY KEY (year, state_code, crop_code)
);
CREATE INDEX production_filters ON production (year, region, state_code, crop_code);

-- Totais do Brasil publicados pela fonte, por lavoura. Não entram nas somas: servem para a conferência.
CREATE TABLE source_national (
  year        INTEGER NOT NULL,
  crop_code   TEXT NOT NULL,
  value_brl   NUMERIC(20, 2),
  quantity_t  NUMERIC(20, 3),
  area_ha     NUMERIC(20, 3),
  PRIMARY KEY (year, crop_code)
);

CREATE TABLE load_log (
  id            BIGSERIAL PRIMARY KEY,
  entity        TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  rows_read     INTEGER,
  rows_saved    INTEGER,
  rows_rejected INTEGER,
  error         TEXT
);
