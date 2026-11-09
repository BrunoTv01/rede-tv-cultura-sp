#!/usr/bin/env bash
# Configura o acesso ao Grafana (painel "Manutenções Rede") na instalação e em cada atualização.
#
# Pergunta o endereço do Grafana e a chave de API (opcional), testa o acesso e grava em
# /etc/rede-tv-cultura.env (GRAFANA_URL, GRAFANA_TOKEN, GRAFANA_DASHBOARD).
# Sem terminal (instalação automática), só testa e mantém o que já estiver configurado.
#
# Uso: sudo ./deploy/grafana-setup.sh [--grafana-url URL] [--grafana-token CHAVE] [--grafana-painel CODIGO] [--sem-grafana]
# Também aceita as variáveis REDETV_GRAFANA_URL, REDETV_GRAFANA_TOKEN e REDETV_GRAFANA=0 (pula).
set -uo pipefail

APP=rede-tv-cultura
ENV_FILE=/etc/$APP.env
PADRAO_URL="http://monitorrede.tvcultura.com.br:3000"
PADRAO_PAINEL="7owPaMFvz"
NOVO_URL="${REDETV_GRAFANA_URL:-}"; NOVO_TOKEN="${REDETV_GRAFANA_TOKEN:-}"; NOVO_PAINEL="${REDETV_GRAFANA_PAINEL:-}"
PULAR=0; [ "${REDETV_GRAFANA:-1}" = "0" ] && PULAR=1

while [ $# -gt 0 ]; do
  case "$1" in
    --grafana-url)    NOVO_URL="${2:-}"; shift 2;;
    --grafana-token)  NOVO_TOKEN="${2:-}"; shift 2;;
    --grafana-painel) NOVO_PAINEL="${2:-}"; shift 2;;
    --sem-grafana)    PULAR=1; shift;;
    *) shift;;
  esac
done

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }

[ "$PULAR" -eq 1 ] && { info "Grafana: configuração pulada"; exit 0; }
[ -f "$ENV_FILE" ] || { warn "Grafana: $ENV_FILE não existe; configure depois pela página."; exit 0; }
command -v curl >/dev/null || { warn "Grafana: sem curl para testar o acesso."; exit 0; }

lerEnv() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
gravarEnv() { # chave valor (valor vazio apaga a linha)
  local tmp; tmp="$(mktemp)"
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  [ -n "$2" ] && printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"   # cat > mantém dono e permissões do arquivo
}

URL_ATUAL="$(lerEnv GRAFANA_URL)"; TOKEN_ATUAL="$(lerEnv GRAFANA_TOKEN)"; PAINEL_ATUAL="$(lerEnv GRAFANA_DASHBOARD)"
URL="${NOVO_URL:-${URL_ATUAL:-$PADRAO_URL}}"
TOKEN="${NOVO_TOKEN:-$TOKEN_ATUAL}"
PAINEL="${NOVO_PAINEL:-${PAINEL_ATUAL:-$PADRAO_PAINEL}}"

# testa: devolve o código HTTP do painel (com chave, se houver)
testar() { # url painel token
  local h=(); [ -n "$3" ] && h=(-H "Authorization: Bearer $3")
  local c; c="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${h[@]}" "$1/api/dashboards/uid/$2" 2>/dev/null)"; echo "${c:-000}"
}

# pergunta só se houver alguém no terminal (o "curl | sudo bash" usa o /dev/tty)
TTY=0
if [ -z "$NOVO_URL$NOVO_TOKEN" ] && [ -r /dev/tty ] && [ -w /dev/tty ] && { : </dev/tty; } 2>/dev/null; then TTY=1; fi

echo
info "Acesso ao Grafana (manutenções das estações)"
if [ "$TTY" -eq 1 ]; then
  {
    echo "   O sistema lê o painel “Manutenções Rede” para marcar as estações sem visita."
    echo "   Aperte Enter para manter o valor entre colchetes. Sem resposta em 60 s, segue com ele."
  } >/dev/tty
  printf '   Endereço do Grafana [%s]: ' "$URL" >/dev/tty
  if read -r -t 60 r </dev/tty; then [ -n "$r" ] && URL="$r"; else echo >/dev/tty; fi
  # quem colar o endereço do painel inteiro: separa endereço e código do painel
  if [[ "$URL" =~ ^(https?://[^/]+)/.*d/([^/?#]+) ]]; then URL="${BASH_REMATCH[1]}"; PAINEL="${BASH_REMATCH[2]}"; fi
  if [ -n "$TOKEN" ]; then
    printf '   Chave de API do Grafana [já cadastrada; Enter mantém, "-" apaga]: ' >/dev/tty
  else
    printf '   Chave de API do Grafana (opcional; Enter = ler sem chave): ' >/dev/tty
  fi
  if read -r -s -t 60 r </dev/tty; then echo >/dev/tty; [ "$r" = "-" ] && TOKEN="" || { [ -n "$r" ] && TOKEN="$r"; }; else echo >/dev/tty; fi
fi
URL="${URL%/}"
[[ "$URL" =~ ^https?:// ]] || { warn "Grafana: endereço inválido ($URL). Mantendo $PADRAO_URL."; URL="$PADRAO_URL"; }

COD="$(testar "$URL" "$PAINEL" "$TOKEN")"
if [ "$COD" != 200 ] && [ -n "$TOKEN" ] && { [ "$COD" = 401 ] || [ "$COD" = 403 ]; }; then
  if [ "$(testar "$URL" "$PAINEL" "")" = 200 ]; then
    warn "Grafana recusou a chave ($COD), mas o painel abre sem login: a chave foi retirada e o sistema lê sem ela."; TOKEN=""; COD=200
  fi
fi
if [ "$COD" = 401 ] && [ -z "$TOKEN" ] && [ "$TTY" -eq 1 ]; then
  printf '   O Grafana pediu login. Cole a chave de API (perfil Viewer): ' >/dev/tty
  if read -r -s -t 120 r </dev/tty; then echo >/dev/tty; TOKEN="$r"; COD="$(testar "$URL" "$PAINEL" "$TOKEN")"; else echo >/dev/tty; fi
fi

gravarEnv GRAFANA_URL "$URL"
gravarEnv GRAFANA_DASHBOARD "$PAINEL"
gravarEnv GRAFANA_TOKEN "$TOKEN"

case "$COD" in
  200) ok "Grafana acessível em $URL ($([ -n "$TOKEN" ] && echo 'com chave de API' || echo 'sem login')). As manutenções são lidas a cada 15 minutos.";;
  000) warn "Grafana: não consegui falar com $URL. O servidor está na rede que alcança o Grafana? Ajuste depois com: sudo /opt/$APP/deploy/grafana-setup.sh";;
  401|403) warn "Grafana: acesso negado ($COD). Crie uma chave de API (perfil Viewer) e rode: sudo /opt/$APP/deploy/grafana-setup.sh";;
  404) warn "Grafana: painel $PAINEL não encontrado em $URL. Rode de novo: sudo /opt/$APP/deploy/grafana-setup.sh";;
  *) warn "Grafana respondeu $COD em $URL. Rode de novo: sudo /opt/$APP/deploy/grafana-setup.sh";;
esac
exit 0
