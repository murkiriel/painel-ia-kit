-- Opcional: só para ligar o mês (MONTH_FILTER=on). O npm run db aplica este arquivo quando o mês está ligado.
-- O SQLite não troca a chave de uma tabela, então ela é recriada, vazia. Uma linha passa a ser por mês, estado e lavoura.
DROP TABLE production;
CREATE TABLE production (
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  state_code  TEXT NOT NULL,
  state_name  TEXT NOT NULL,
  region      TEXT NOT NULL,
  crop_code   TEXT NOT NULL,
  crop_name   TEXT NOT NULL,
  value_brl   INTEGER,
  quantity_t  INTEGER,
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('t', 'a verificar')),
  area_ha     INTEGER,
  PRIMARY KEY (year, month, state_code, crop_code)
) STRICT;
CREATE INDEX production_filters ON production (year, month, region, state_code, crop_code);
