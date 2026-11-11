#!/usr/bin/env bash
# Configura o acesso aos dois painéis do Grafana na instalação e em cada atualização:
#   1. Manutenções Rede  http://monitorrede.tvcultura.com.br:3000/d/7owPaMFvz   (GRAFANA_URL, GRAFANA_TOKEN, GRAFANA_DASHBOARD)
#   2. Dashboard Estações (telemetria, estações no ar)
#                        http://172.20.0.250:3000/d/fKcYfojvz                    (TELEMETRIA_URL, TELEMETRIA_TOKEN, TELEMETRIA_DASHBOARD)
# Os endereços entram sozinhos. Testa o acesso e grava em /etc/rede-tv-cultura.env.
# Só pergunta a chave/token se o Grafana pedir login. Sem terminal (instalação automática), só testa e grava.
#
# Uso: sudo ./deploy/grafana-setup.sh [--grafana-url URL] [--grafana-token CHAVE] [--sem-grafana]
#                                     [--telemetria-url URL] [--telemetria-token TOKEN] [--sem-telemetria]
set -uo pipefail

APP=rede-tv-cultura
ENV_FILE="${REDETV_ENV_FILE:-/etc/$APP.env}"   # na instalação Docker: /opt/rede-tv-cultura-docker/.env
G_URL="${REDETV_GRAFANA_URL:-}"; G_TOKEN="${REDETV_GRAFANA_TOKEN:-}"; G_PAINEL="${REDETV_GRAFANA_PAINEL:-}"; G_PULAR=0
T_URL="${REDETV_TELEMETRIA_URL:-}"; T_TOKEN="${REDETV_TELEMETRIA_TOKEN:-}"; T_PAINEL=""; T_PULAR=0
[ "${REDETV_GRAFANA:-1}" = "0" ] && G_PULAR=1
[ "${REDETV_TELEMETRIA:-1}" = "0" ] && T_PULAR=1

while [ $# -gt 0 ]; do
  case "$1" in
    --grafana-url)       G_URL="${2:-}"; shift 2;;
    --grafana-token)     G_TOKEN="${2:-}"; shift 2;;
    --grafana-painel)    G_PAINEL="${2:-}"; shift 2;;
    --sem-grafana)       G_PULAR=1; shift;;
    --telemetria-url)    T_URL="${2:-}"; shift 2;;
    --telemetria-token)  T_TOKEN="${2:-}"; shift 2;;
    --telemetria-painel) T_PAINEL="${2:-}"; shift 2;;
    --sem-telemetria)    T_PULAR=1; shift;;
    *) shift;;
  esac
done

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }

[ -f "$ENV_FILE" ] || { warn "Grafana: $ENV_FILE não existe; configure depois pela página."; exit 0; }
command -v curl >/dev/null || { warn "Grafana: sem curl para testar o acesso."; exit 0; }

lerEnv() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
gravarEnv() { # chave valor (valor vazio apaga a linha)
  local tmp; tmp="$(mktemp)"
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  [ -n "$2" ] && printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"   # cat > mantém dono e permissões do arquivo
}
# devolve o código HTTP do painel (com chave, se houver)
testar() { # url painel token
  local h=(); [ -n "$3" ] && h=(-H "Authorization: Bearer $3")
  local c; c="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${h[@]}" "$1/api/dashboards/uid/$2" 2>/dev/null)"; echo "${c:-000}"
}
# chave/token que foi colado pela página do mapa (fica no banco, tabela config)
tokenDoBanco() { # chave da config: grafana | telemetria
  local q="SELECT coalesce(valor->>'token','') FROM config WHERE chave='$1'"
  if [ -n "${REDETV_SQL:-}" ]; then $REDETV_SQL -tAc "$q" 2>/dev/null </dev/null | head -1 | tr -d '[:space:]'; return 0; fi  # Docker
  local db; db="$(lerEnv DATABASE_URL)"; [ -n "$db" ] && command -v psql >/dev/null || return 0
  psql "$db" -tAc "$q" 2>/dev/null | head -1 | tr -d '[:space:]'
}
# pergunta só se houver alguém no terminal (o "curl | sudo bash" usa o /dev/tty)
temTTY() { [ -r /dev/tty ] && [ -w /dev/tty ] && { : </dev/tty; } 2>/dev/null; }
REFAZER="${REDETV_REFAZER:-sudo /opt/$APP/deploy/grafana-setup.sh}"

# configurar TÍTULO PREFIXO URL_PADRÃO PAINEL_PADRÃO SLUG URL_NOVA TOKEN_NOVO PAINEL_NOVO "o que faz" "tipo de chave" CHAVE_CONFIG
configurar() {
  local titulo="$1" pre="$2" url="${6:-$3}" painel="${8:-$4}" slug="$5" token="${7:-$(lerEnv "${2}_TOKEN")}" faz="$9" chave="${10}"
  # sem token no arquivo: aproveita o que foi colado na página do mapa
  [ -z "$token" ] && token="$(tokenDoBanco "${11}")"
  local perguntar=0; [ -z "$7" ] && temTTY && perguntar=1
  echo
  info "Grafana · $titulo"
  if [[ "$url" =~ ^(https?://[^/]+)/.*d/([^/?#]+) ]]; then url="${BASH_REMATCH[1]}"; painel="${BASH_REMATCH[2]}"; fi
  url="${url%/}"
  [[ "$url" =~ ^https?:// ]] || { warn "Endereço inválido ($url). Usando $3."; url="$3"; }
  info "Painel: $url/d/$painel/$slug?orgId=1"
  local cod; cod="$(testar "$url" "$painel" "$token")"
  if [ -n "$token" ] && { [ "$cod" = 401 ] || [ "$cod" = 403 ]; } && [ "$(testar "$url" "$painel" "")" = 200 ]; then
    warn "O Grafana recusou a chave ($cod), mas o painel abre sem login: a chave foi retirada."; token=""; cod=200
  fi
  if { [ "$cod" = 401 ] || [ "$cod" = 403 ]; } && [ "$perguntar" -eq 1 ]; then
    printf '   Este Grafana pede login. Cole %s (perfil Viewer), ou Enter para pular: ' "$chave" >/dev/tty
    local r; if read -r -s -t 120 r </dev/tty; then echo >/dev/tty; [ -n "$r" ] && { token="$r"; cod="$(testar "$url" "$painel" "$token")"; }; else echo >/dev/tty; fi
  fi
  gravarEnv "${pre}_URL" "$url"
  gravarEnv "${pre}_DASHBOARD" "$painel"
  gravarEnv "${pre}_TOKEN" "$token"
  case "$cod" in
    200) ok "Acesso ok ($([ -n "$token" ] && echo 'com chave' || echo 'sem login')). $faz";;
    000) warn "Não consegui falar com $url. O servidor está na rede que alcança esse Grafana? Depois rode: $REFAZER";;
    401|403) warn "Acesso negado ($cod): falta $chave. Crie no Grafana (perfil Viewer) e rode: $REFAZER";;
    404) warn "Painel $painel não encontrado em $url. Rode de novo: $REFAZER";;
    *) warn "O Grafana respondeu $cod em $url. Rode de novo: $REFAZER";;
  esac
}

if [ "$G_PULAR" -eq 1 ]; then info "Grafana · Manutenções Rede: pulado"; else
  configurar "Manutenções Rede (estações sem visita)" GRAFANA "http://monitorrede.tvcultura.com.br:3000" "7owPaMFvz" "manutencoes-rede" \
    "$G_URL" "$G_TOKEN" "$G_PAINEL" "As manutenções são lidas a cada hora." "a chave de API" grafana
fi
if [ "$T_PULAR" -eq 1 ]; then info "Grafana · Dashboard Estações: pulado"; else
  configurar "Dashboard Estações (transmissores no ar)" TELEMETRIA "http://172.20.0.250:3000" "fKcYfojvz" "dashboard-estacoes" \
    "$T_URL" "$T_TOKEN" "$T_PAINEL" "A situação dos transmissores é lida a cada 5 minutos." "o token de conta de serviço" telemetria
fi
exit 0
