-- Opcional: só para ligar o mês (MONTH_FILTER=on). Rode com a tabela vazia, antes da carga com a coluna month.
-- Uma linha passa a ser por mês, estado e lavoura.
ALTER TABLE production ADD COLUMN month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12);
ALTER TABLE production DROP CONSTRAINT production_pkey, ADD PRIMARY KEY (year, month, state_code, crop_code);
DROP INDEX production_filters;
CREATE INDEX production_filters ON production (year, month, region, state_code, crop_code);
