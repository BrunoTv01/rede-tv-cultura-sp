#!/usr/bin/env bash
# Baixa e instala a Rede TV Cultura SP com banco de dados PostgreSQL local, num comando só.
#
#   curl -fsSL https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar.sh | sudo bash
#
# Opções podem ser passadas depois de "bash -s --", por exemplo:
#   curl -fsSL .../instalar.sh | sudo bash -s -- --nginx
#
# Se o sistema já estiver instalado, este mesmo comando atualiza para a versão mais nova
# (com backup do banco antes), sem perder dados.
set -euo pipefail

# Tudo fica dentro de main(): o bash lê o script inteiro antes de executar.
# Assim, quando vem por "wget ... | sudo bash", nenhum comando (apt-get, dpkg)
# consegue consumir o resto do instalador pela entrada padrão.
main() {
  REPO="BrunoTv01/rede-tv-cultura-sp"
  BRANCH="${REDETV_BRANCH:-main}"
  URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"

  ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
  info() { printf '\033[36m→\033[0m %s\n' "$*"; }
  fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

  [ "$(id -u)" -eq 0 ] || fail "Rode como root. Ex.: curl -fsSL https://raw.githubusercontent.com/$REPO/main/instalar.sh | sudo bash"
  # Ubuntu Desktop vem sem curl: tenta instalar; se não der, usa o wget
  # (nada aqui pode derrubar o instalador: se o apt estiver ocupado, segue com o wget)
  if ! command -v curl >/dev/null; then
    if command -v apt-get >/dev/null; then
      info "Instalando o curl (se o Ubuntu estiver se atualizando, aguarda terminar)"
      apt-get -o DPkg::Lock::Timeout=600 update -qq </dev/null >/dev/null 2>&1 || true
      DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl </dev/null >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null; then dnf install -y -q curl </dev/null >/dev/null 2>&1 || true; fi
  fi
  command -v curl >/dev/null || command -v wget >/dev/null || fail "Não há curl nem wget. Rode: sudo apt-get install -y curl"
  baixar() { if command -v curl >/dev/null; then curl -fsSL "$1" -o "$2"; else wget -q "$1" -O "$2"; fi; }
  command -v tar  >/dev/null || fail "O comando tar não está instalado."

  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  info "Baixando o Rede TV Cultura SP ($BRANCH)"
  baixar "$URL" "$TMP/redetv.tar.gz" || fail "Não consegui baixar de $URL. O servidor tem acesso à internet?"
  tar xzf "$TMP/redetv.tar.gz" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -type d -name 'rede-tv-cultura-sp-*' | head -1)"
  [ -f "$SRC/deploy/install.sh" ] || fail "O arquivo baixado não tem o instalador."
  VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/package.json")"
  ok "Versão $VER baixada"

  # guarda uma cópia do código em /opt/rede-tv-cultura-src para futuras atualizações e consulta
  rm -rf /opt/rede-tv-cultura-src && cp -r "$SRC" /opt/rede-tv-cultura-src
  chmod +x /opt/rede-tv-cultura-src/deploy/*.sh

  if [ -f /etc/systemd/system/rede-tv-cultura.service ] && [ -f /etc/rede-tv-cultura.env ] && [ -d /opt/rede-tv-cultura ]; then
    info "Rede TV Cultura SP já instalado: atualizando"
    exec /opt/rede-tv-cultura-src/deploy/update.sh </dev/null
  else
    exec /opt/rede-tv-cultura-src/deploy/install.sh "$@" </dev/null
  fi
}

main "$@"
