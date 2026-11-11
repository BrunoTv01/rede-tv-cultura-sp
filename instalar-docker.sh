#!/usr/bin/env bash
# Instala (ou atualiza) a Rede TV Cultura SP em Docker, num comando só. Ideal para uma VM.
#
#   curl -fsSL https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar-docker.sh | sudo bash
#
# O que faz:
#   - instala o Docker e o Docker Compose, se faltarem;
#   - baixa a versão mais nova para /opt/rede-tv-cultura-docker;
#   - cria o .env com uma senha aleatória para o banco (só na primeira vez);
#   - em atualização, faz backup do banco antes (pasta backups/, guarda os 10 últimos);
#   - sobe o banco (PostgreSQL) e o mapa, e configura o acesso aos dois painéis do Grafana.
# Rodar de novo o mesmo comando atualiza, sem perder dados.
#
# Opções (depois de "bash -s --"):
#   --porta N               porta do mapa (padrão 3100)
#   --restaurar ARQUIVO     carrega um backup (.sql ou .sql.gz), por exemplo o banco vindo do Raspberry
#   --telemetria-token T    token do Grafana do Dashboard Estações, sem perguntar
#   --sem-grafana / --sem-telemetria   pula a configuração desses painéis
set -euo pipefail

main() {
  REPO="BrunoTv01/rede-tv-cultura-sp"
  BRANCH="${REDETV_BRANCH:-main}"
  DIR="${REDETV_DIR:-/opt/rede-tv-cultura-docker}"
  PROJ="rede-tv-cultura"
  PORTA=""; RESTAURAR=""; GARGS=()

  ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
  info() { printf '\033[36m→\033[0m %s\n' "$*"; }
  warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
  fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

  while [ $# -gt 0 ]; do
    case "$1" in
      --porta)     PORTA="${2:-}"; shift 2;;
      --restaurar) RESTAURAR="${2:-}"; shift 2;;
      --grafana-url|--grafana-token|--grafana-painel|--telemetria-url|--telemetria-token|--telemetria-painel) GARGS+=("$1" "${2:-}"); shift 2;;
      --sem-grafana|--sem-telemetria) GARGS+=("$1"); shift;;
      --docker) shift;;
      -h|--help) sed -n '2,20p' "$0"; exit 0;;
      *) fail "Opção desconhecida: $1";;
    esac
  done
  [ -z "$PORTA" ] || [[ "$PORTA" =~ ^[0-9]+$ ]] || fail "--porta precisa ser um número."
  if [ -n "$RESTAURAR" ]; then RESTAURAR="$(readlink -f "$RESTAURAR")"; [ -f "$RESTAURAR" ] || fail "Backup não encontrado: $RESTAURAR"; fi

  [ "$(id -u)" -eq 0 ] || fail "Rode como root. Ex.: curl -fsSL https://raw.githubusercontent.com/$REPO/main/instalar-docker.sh | sudo bash"
  command -v curl >/dev/null || {
    info "Instalando o curl"
    if command -v apt-get >/dev/null; then apt-get update -qq </dev/null >/dev/null 2>&1 || true; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates </dev/null >/dev/null
    elif command -v dnf >/dev/null; then dnf install -y -q curl </dev/null >/dev/null; fi
  }
  command -v curl >/dev/null || fail "Não consegui instalar o curl."

  # ---------- Docker ----------
  if ! command -v docker >/dev/null; then
    info "Instalando o Docker (alguns minutos)"
    curl -fsSL https://get.docker.com | sh </dev/null >/dev/null 2>&1 || {
      warn "O instalador oficial do Docker falhou; tentando pelos pacotes do sistema"
      if command -v apt-get >/dev/null; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io </dev/null >/dev/null
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-v2 </dev/null >/dev/null 2>&1 \
          || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin </dev/null >/dev/null 2>&1 || true
      elif command -v dnf >/dev/null; then dnf install -y -q docker docker-compose-plugin </dev/null >/dev/null || true; fi
    }
  fi
  command -v docker >/dev/null || fail "Não consegui instalar o Docker. Instale manualmente (https://docs.docker.com/engine/install/) e rode de novo."
  command -v systemctl >/dev/null && systemctl enable --now docker >/dev/null 2>&1 || true
  docker info >/dev/null 2>&1 || fail "O Docker está instalado mas não está rodando. Tente: sudo systemctl start docker"
  docker compose version >/dev/null 2>&1 || fail "Falta o Docker Compose. Instale o pacote docker-compose-plugin (ou docker-compose-v2) e rode de novo."
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) · $(docker compose version --short 2>/dev/null)"

  # ---------- código ----------
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  if [ -n "${REDETV_SRC:-}" ] && [ -f "$REDETV_SRC/docker-compose.yml" ]; then SRC="$REDETV_SRC"
  else
    info "Baixando o Rede TV Cultura SP ($BRANCH)"
    curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" -o "$TMP/redetv.tar.gz" || fail "Não consegui baixar do GitHub. A VM tem acesso à internet?"
    tar xzf "$TMP/redetv.tar.gz" -C "$TMP"
    SRC="$(find "$TMP" -maxdepth 1 -type d -name 'rede-tv-cultura-sp-*' | head -1)"
  fi
  [ -f "$SRC/docker-compose.yml" ] || fail "O arquivo baixado não tem o docker-compose.yml."
  VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/package.json")"
  ok "Versão $VER"

  mkdir -p "$DIR/backups"
  dc() { docker compose -p "$PROJ" --project-directory "$DIR" -f "$DIR/docker-compose.yml" "$@"; }
  JA=0; [ -f "$DIR/docker-compose.yml" ] && [ -f "$DIR/.env" ] && JA=1

  # backup antes de atualizar
  if [ "$JA" -eq 1 ] && dc ps --status running --services 2>/dev/null | grep -qx db; then
    BK="$DIR/backups/redetv-$(date +%Y%m%d-%H%M%S).sql.gz"
    info "Backup do banco antes de atualizar"
    if dc exec -T db pg_dump -U redetv -d redetv --no-owner --no-privileges | gzip > "$BK" && [ -s "$BK" ]; then
      ok "Backup em $BK"
      ls -1t "$DIR"/backups/redetv-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
    else rm -f "$BK"; warn "Não consegui fazer o backup; seguindo mesmo assim."; fi
  fi

  # troca o código, mantendo .env e backups
  find "$DIR" -mindepth 1 -maxdepth 1 ! -name .env ! -name backups -exec rm -rf {} +
  cp -r "$SRC"/. "$DIR"/
  chmod +x "$DIR"/deploy/*.sh "$DIR"/*.sh 2>/dev/null || true

  # ---------- .env ----------
  if [ ! -f "$DIR/.env" ]; then
    SENHA="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 || true)"
    { echo "# Rede TV Cultura SP (Docker) · criado em $(date '+%d/%m/%Y %H:%M')"
      echo "# Senha interna do banco: não mude depois da instalação (o banco já foi criado com ela)."
      echo "DB_PASSWORD=$SENHA"
      echo "PORT=${PORTA:-3100}"; } > "$DIR/.env"
    chmod 600 "$DIR/.env"
    ok "Arquivo $DIR/.env criado"
  elif [ -n "$PORTA" ]; then
    grep -v '^PORT=' "$DIR/.env" > "$TMP/env"; echo "PORT=$PORTA" >> "$TMP/env"; cat "$TMP/env" > "$DIR/.env"
  fi
  PORT="$(sed -n 's/^PORT=//p' "$DIR/.env" | tail -1)"; PORT="${PORT:-3100}"

  # ---------- sobe ----------
  info "Montando e subindo os contêineres (na primeira vez demora alguns minutos)"
  # se a rede interna mudou de faixa, o compose recusa subir: derruba (sem apagar o banco) e sobe de novo
  dc up -d --build --remove-orphans db >/dev/null 2>&1 || { dc down --remove-orphans >/dev/null 2>&1 || true; dc up -d --build --remove-orphans db; }
  for _ in $(seq 1 60); do dc exec -T db pg_isready -U redetv -d redetv >/dev/null 2>&1 && break; sleep 2; done
  dc exec -T db pg_isready -U redetv -d redetv >/dev/null 2>&1 || fail "O banco não subiu. Veja: docker compose -p $PROJ logs db"
  ok "Banco pronto"

  if [ -n "$RESTAURAR" ]; then
    info "Restaurando o backup $(basename "$RESTAURAR")"
    dc stop app >/dev/null 2>&1 || true
    dc exec -T db psql -q -U redetv -d redetv -c 'SET client_min_messages=warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
    if [[ "$RESTAURAR" == *.gz ]]; then gzip -dc "$RESTAURAR"; else cat "$RESTAURAR"; fi \
      | sed -E '/^(ALTER .* OWNER TO|GRANT |REVOKE |SET default_table_access_method)/d' \
      | dc exec -T db psql -q -U redetv -d redetv -v ON_ERROR_STOP=0 >/dev/null 2>"$TMP/rest.err" || true
    { grep -i 'error' "$TMP/rest.err" | grep -v 'already exists' | head -3 | while read -r l; do warn "$l"; done; } || true
    ok "Backup restaurado"
  fi

  dc up -d --build --remove-orphans >/dev/null 2>&1 || dc up -d --build --remove-orphans
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || fail "O mapa não respondeu na porta $PORT. Veja: docker compose -p $PROJ logs app"
  ok "Mapa no ar (versão $VER)"

  # ---------- Grafana ----------
  REDETV_ENV_FILE="$DIR/.env" \
  REDETV_SQL="docker compose -p $PROJ --project-directory $DIR -f $DIR/docker-compose.yml exec -T db psql -U redetv -d redetv" \
  REDETV_REFAZER="curl -fsSL https://raw.githubusercontent.com/$REPO/main/instalar-docker.sh | sudo bash" \
    bash "$DIR/deploy/grafana-setup.sh" "${GARGS[@]}" || true
  dc up -d >/dev/null 2>&1 || true   # aplica o que mudou no .env (endereços e tokens do Grafana)

  docker image prune -f >/dev/null 2>&1 || true
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  ok "Pronto! Abra http://${IP:-IP-DA-VM}:$PORT"
  [ "$JA" -eq 0 ] && [ -z "$RESTAURAR" ] && info "Primeiro acesso: usuário admin, senha admin (o sistema pede para trocar)."
  info "Arquivos em $DIR · backups em $DIR/backups"
  info "Para atualizar depois, rode o mesmo comando de instalação."
}

main "$@"
