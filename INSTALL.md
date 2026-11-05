# Instalação num servidor Linux

O sistema roda num servidor da rede interna, com banco de dados PostgreSQL e login por usuário e senha. Funciona em Ubuntu, Debian, Rocky, Alma, RHEL e CentOS Stream.

## Instalar com um comando

No servidor, com acesso à internet:

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar.sh | sudo bash
```

Se o Ubuntu vier sem o `curl`, use:

```bash
wget -qO- https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar.sh | sudo bash
```

O instalador faz tudo sozinho:

- instala o Node.js 22 e o PostgreSQL;
- cria o banco `redetv` com uma senha aleatória;
- carrega as 223 estações;
- cria o usuário `admin`;
- deixa o sistema rodando como serviço, que inicia junto com o servidor.

No final ele mostra o endereço de acesso, algo como:

```
✔ Rede TV Cultura SP instalada
   Endereço:          http://192.168.0.50:3100
   Login:             admin
   Senha:             admin   (o sistema pede uma senha nova no primeiro acesso)
```

## Primeiro acesso

1. Abra o endereço no navegador de qualquer computador da rede.
2. Entre com o usuário **admin** e a senha **admin**.
3. O sistema pede uma senha nova. Ela precisa ter 8 caracteres ou mais, com letras e números.
4. No menu do seu nome, no canto superior direito, abra **Usuários** e cadastre as outras pessoas.

Cada pessoa recebe uma senha provisória e cria a própria senha no primeiro acesso. Os perfis são:

| Perfil | O que pode fazer |
|---|---|
| Leitura | Consultar o mapa, a tabela e o histórico; exportar CSV |
| Editor | Tudo da Leitura, e também incluir, editar, mover e excluir estações |
| Admin | Tudo do Editor, e também cadastrar pessoas, redefinir senhas e restaurar estações excluídas |

Os nomes das áreas e dos responsáveis também podem ser trocados: use **Editar nomes**, ao lado de “Área / responsável” no painel da esquerda (perfis Editor e Admin). O mapa mostra em cada área só o nome do responsável.

Toda alteração fica registrada com o nome de quem fez e a data. Para consultar, use **Histórico de alterações**, no menu do seu nome, ou **Ver histórico desta estação**, na ficha de cada estação.

## Opções do instalador

As opções vão depois de `bash -s --`, por exemplo:

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar.sh | sudo bash -s -- --nginx
```

| Opção | Efeito |
|---|---|
| `--porta N` | Porta do sistema (padrão **3100**) |
| `--senha S` | Senha inicial do `admin` em vez de `admin`. Numa reinstalação, redefine a senha do `admin` |
| `--nginx` | Publica na porta 80 por meio do nginx, para acessar só por `http://IP-DO-SERVIDOR` |
| `--dominio NOME` | Nome do site no nginx, por exemplo `mapa.empresa.local` |
| `--sem-banco` | Não instala PostgreSQL; usa o banco informado em `DATABASE_URL` |

Se o BTS Compress estiver no mesmo servidor, não há conflito: ele usa a porta 3000 e este sistema usa a 3100. Se os dois forem usar o nginx na porta 80, informe um `--dominio` diferente para cada um.

## Instalar sem internet no servidor

1. Num computador com internet, baixe o projeto em https://github.com/BrunoTv01/rede-tv-cultura-sp, pelo botão **Code → Download ZIP**.
2. Na mesma máquina, entre na pasta e rode `npm install --omit=dev`, para baixar as dependências.
3. Copie a pasta inteira, já com `node_modules`, para o servidor.
4. No servidor, dentro da pasta, rode `sudo ./deploy/install.sh`.

O servidor ainda precisa conseguir instalar o Node.js e o PostgreSQL pelo gerenciador de pacotes. Se eles já estiverem instalados, o instalador usa os existentes.

## Uso no dia a dia

| Tarefa | Comando |
|---|---|
| Ver se está rodando | `systemctl status rede-tv-cultura` |
| Ver o log | `journalctl -u rede-tv-cultura -f` |
| Reiniciar | `sudo systemctl restart rede-tv-cultura` |
| Atualizar para a versão mais nova | o mesmo comando da instalação (faz backup antes e mantém os dados) |
| Fazer backup do banco | `sudo /opt/rede-tv-cultura/deploy/backup.sh` |
| Backup automático todo dia às 02:30 | `sudo /opt/rede-tv-cultura/deploy/backup.sh --agendar` |
| Restaurar um backup | `sudo /opt/rede-tv-cultura/deploy/backup.sh --restaurar /var/backups/rede-tv-cultura/ARQUIVO.sql.gz` |
| Esqueceu a senha do admin | `sudo /opt/rede-tv-cultura/deploy/reset-senha.sh`, que volta para admin / admin |
| Senha provisória para outra pessoa | `sudo /opt/rede-tv-cultura/deploy/reset-senha.sh maria Prov1234` |
| Remover o sistema (mantém o banco) | `sudo /opt/rede-tv-cultura/deploy/uninstall.sh` |
| Remover tudo, inclusive o banco | `sudo /opt/rede-tv-cultura/deploy/uninstall.sh --apagar-banco`, que faz um backup antes |

Os backups ficam em `/var/backups/rede-tv-cultura`, e o sistema mantém os 30 mais recentes.

## Onde ficam as coisas

| O quê | Onde |
|---|---|
| Sistema | `/opt/rede-tv-cultura` |
| Configuração (porta, banco, senha inicial) | `/etc/rede-tv-cultura.env` |
| Banco de dados | PostgreSQL local, banco `redetv`, usuário `redetv` |
| Serviço | `rede-tv-cultura` (systemd) |
| Backups | `/var/backups/rede-tv-cultura` |

## Instalar com Docker

Se o servidor já usa Docker, rode dentro da pasta do projeto:

```bash
docker compose up -d
```

Abra `http://IP-DO-SERVIDOR:3100` e entre com admin / admin. Para mudar a porta ou a senha inicial, copie o `.env.example` para `.env` e preencha.

## Problemas comuns

- **A página não abre de outro computador.** Confira se a porta 3100 está liberada no firewall: `sudo ufw allow 3100/tcp`.
- **"Usuário ou senha incorretos".** Use `reset-senha.sh` (veja acima). Depois de 5 senhas erradas, o usuário fica bloqueado por 10 minutos; reiniciar o serviço também zera o bloqueio.
- **O instalador para com erro de pacotes.** Rode `sudo apt-get update` e veja se alguma linha começa com `E:`. Normalmente é uma fonte de pacotes com problema.
