-- Rodam com o schema do dashboard como search_path (npm run db): os nomes das tabelas não levam prefixo.
-- Os usuários de banco são deste dashboard: nenhum deles enxerga o schema de outro dashboard nem o das pessoas e sessões.
-- Consulta, inclusive a do agente: só lê os dados.
GRANT USAGE ON SCHEMA producao_agricola TO producao_agricola_reader, producao_agricola_loader;
GRANT SELECT ON production, source_national, load_log TO producao_agricola_reader;

-- Carga: escreve só nas tabelas de dados e no log.
GRANT SELECT, INSERT, UPDATE, DELETE ON raw_production, production, source_national, load_log TO producao_agricola_loader;
GRANT USAGE ON SEQUENCE load_log_id_seq TO producao_agricola_loader;
