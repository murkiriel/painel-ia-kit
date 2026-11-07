GRANT USAGE ON SCHEMA portal TO dash_auth, dash_portal;

-- Login: lê usuários e acessos e cuida das sessões. Não enxerga os dados dos dashboards, e não cria nem altera pessoas.
GRANT SELECT ON app_user, dashboard_access TO dash_auth;
GRANT SELECT, INSERT, DELETE ON app_session TO dash_auth;

-- Administração: cria e altera pessoas e acessos, e troca senhas. O servidor só a usa depois de confirmar que quem pede é administrador
-- (ou, na troca de senha, a própria pessoa). Também não enxerga os dados dos dashboards.
GRANT SELECT ON app_user, dashboard_access, app_session TO dash_portal;
GRANT INSERT, UPDATE ON app_user TO dash_portal;
GRANT INSERT, UPDATE, DELETE ON dashboard_access TO dash_portal;
GRANT DELETE ON app_session TO dash_portal;
GRANT USAGE ON SEQUENCE app_user_id_seq TO dash_portal;

-- Primeiro login: o usuário de login não grava em app_user. Esta função grava, e só com a tabela vazia.
CREATE OR REPLACE FUNCTION create_first_user(p_login TEXT, p_name TEXT, p_hash TEXT, p_salt TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = portal, pg_temp AS $$
BEGIN
  -- Em uma transação antiga, a tabela continuaria parecendo vazia depois de criado o primeiro login.
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'create_first_user exige read committed'; END IF;
  LOCK TABLE app_user IN EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM app_user) THEN RETURN FALSE; END IF;
  INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin) VALUES (p_login, p_name, p_hash, p_salt, TRUE);
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION create_first_user(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_first_user(TEXT, TEXT, TEXT, TEXT) TO dash_auth;

-- Categorias: o login só lê (para agrupar os cartões), e a administração grava. Os usuários dos dashboards não enxergam estas tabelas.
GRANT SELECT ON category, dashboard_category TO dash_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON category, dashboard_category TO dash_portal;
GRANT USAGE ON SEQUENCE category_id_seq TO dash_portal;
