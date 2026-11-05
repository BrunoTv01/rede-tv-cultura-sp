-- Rede TV Cultura SP · banco PostgreSQL
-- Roda em toda inicialização: só cria o que ainda não existe.

-- Estações. Cada estação guarda seus campos num documento JSON (veja README.md, "Formato").
CREATE TABLE IF NOT EXISTS estacoes (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Histórico de alterações (estações e usuários)
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  tbl        TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  context    TEXT,
  username   TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS audit_log_row ON audit_log(tbl, row_id);

-- Usuários e sessões de login
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
  password_hash  TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  must_change    BOOLEAN NOT NULL DEFAULT false,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Áreas de manutenção: nome e responsável editáveis pela página
CREATE TABLE IF NOT EXISTS areas (
  id           INTEGER PRIMARY KEY,
  nome         TEXT NOT NULL,
  responsavel  TEXT NOT NULL,
  ordem        INTEGER NOT NULL DEFAULT 0
);
INSERT INTO areas (id, nome, responsavel, ordem) VALUES
  (1, 'Área 1', 'Equipe SP1', 1),
  (5, 'Área 1', 'Equipe Costa Norte', 2),
  (2, 'Área 2', 'Equipe SP2', 3),
  (3, 'Área 3', 'Saile Telecom (Elias)', 4),
  (4, 'Área 4', 'Alexandre Cosme', 5)
ON CONFLICT (id) DO NOTHING;
