# Instalação num servidor Linux

O sistema roda num servidor da rede interna, com banco de dados PostgreSQL e login por usuário e senha. Funciona em Ubuntu, Debian, Rocky, Alma, RHEL e CentOS Stream.

## Instalação em Docker (VM)

Num comando só, numa VM Linux (Ubuntu, Debian, Rocky…) com acesso à internet:

```
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar-docker.sh | sudo bash
```

O instalador:

- instala o Docker e o Docker Compose, se faltarem;
- coloca o sistema em `/opt/rede-tv-cultura-docker` e cria o `.env` com uma senha aleatória para o banco;
- sobe dois contêineres: **db** (PostgreSQL 16) e **app** (o mapa, porta 3100);
- configura os dois painéis do Grafana (endereços automáticos; pede o token do Dashboard Estações se ainda não houver);
- no fim mostra o endereço, por exemplo `http://IP-DA-VM:3100` (primeiro acesso: admin / admin).

**Atualizar:** rode o mesmo comando. Antes de trocar a versão ele faz backup do banco em `/opt/rede-tv-cultura-docker/backups` (guarda os 10 últimos). Dados, usuários e configuração continuam.

**Levar os dados do Raspberry para a VM:**

1. No Raspberry: `sudo -u postgres pg_dump redetv | gzip > redetv.sql.gz`
2. Copie o arquivo para a VM (por exemplo `scp redetv.sql.gz usuario@IP-DA-VM:`).
3. Na VM: `curl -fsSL https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar-docker.sh | sudo bash -s -- --restaurar ~/redetv.sql.gz`

Usuários, senhas, estações, nomes das áreas, divisões e a configuração do Grafana vêm juntos.

**Opções:** `--porta N` (outra porta), `--restaurar ARQUIVO`, `--telemetria-token T`, `--sem-grafana`, `--sem-telemetria`.

**Comandos úteis** (na pasta `/opt/rede-tv-cultura-docker`):

| Para | Comando |
|---|---|
| Ver se está rodando | `sudo docker compose -p rede-tv-cultura ps` |
| Ver os registros do mapa | `sudo docker compose -p rede-tv-cultura logs -f app` |
| Reiniciar | `sudo docker compose -p rede-tv-cultura restart` |
| Backup manual | `sudo docker compose -p rede-tv-cultura exec -T db pg_dump -U redetv redetv \| gzip > backup.sql.gz` |

A rede interna do Docker usa a faixa `192.168.203.0/24`, para não bater com a rede da FPA (o Grafana da telemetria fica em 172.20.0.250). Se precisar de outra, coloque `REDETV_SUBNET=...` no `.env` e rode o instalador de novo.

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

**Atalho como aplicativo:** o sistema tem ícone próprio (mapa do estado de São Paulo com a torre transmitindo). No Chrome ou Edge do computador, use o menu ⋮ → **Transmitir, salvar e compartilhar → Instalar página como app** (ou o ícone de instalar na barra de endereço). No celular: Android, menu ⋮ → **Adicionar à tela inicial**; iPhone, **Compartilhar → Adicionar à Tela de Início**. Ele abre em janela própria, como um programa.


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

Os nomes das estações podem ser reposicionados por quem tem perfil Editor ou Admin. Use o botão **Aa**, abaixo do zoom, o item **Mover nomes das estações**, no menu do seu nome, ou o botão **Mover nome**, na ficha da estação. Depois arraste cada nome para o lugar certo. Ao soltar, a posição fica gravada. Quando o nome fica longe da estação, aparece uma linha ligando os dois. Clique duplo num nome para ele voltar para perto da estação. Para terminar, clique em **Concluir**.

Se a estação for movida depois, o nome vai junto. Se o canal ou o VT mudarem, o texto se atualiza e a posição continua. A impressão em prancha usa a mesma posição.

As linhas vermelhas que dividem as áreas podem ser ajustadas pelo **Admin**, no menu do seu nome, em **Ajustar linhas de divisão**. A barra que aparece no mapa tem:

| Botão | O que faz |
|---|---|
| Arrastar os pontos brancos | Move a linha. Clique numa linha para criar um ponto; clique duplo num ponto para apagar |
| **Gerar automático** | Parte do desenho original e só redesenha em volta das estações que mudaram de área ou de lugar. Sem mudanças, fica igual ao original. Depois de salvar, as linhas **mudam sozinhas** sempre que alguém muda a área ou a posição de uma estação |
| **Nova linha** | Desenha uma linha nova, clicando ponto a ponto; termine com clique duplo |
| **Desenho original** | Volta às linhas do DWG |
| **Salvar** / **Cancelar** | Grava para todos os usuários, ou descarta o que foi feito |

Se você arrastar um ponto depois de gerar automático, as linhas passam para **ajuste manual** e deixam de acompanhar as estações. Para voltar ao automático, clique de novo em **Gerar automático** e salve.

Para desfazer as mudanças, o **Admin** usa **Voltar ao mapa original**, no menu do seu nome. Ele escolhe o que volta ao original:

- linhas de divisão;
- área de cada estação;
- posição das estações;
- nomes das áreas e responsáveis;
- todos os dados das estações. Esta opção também recupera as excluídas e retira as incluídas.

O sistema pede confirmação antes de aplicar. Tudo fica no histórico com o valor anterior.

As linhas são só o desenho do mapa: a cor de cada região segue a maioria das estações dentro dela, mas a área de cada estação continua sendo a do campo **Área** da ficha. Cada gravação fica no histórico.

Para imprimir o mapa igual à planta do AutoCAD (“Mapa de rotas – Nova Divisão”), use o botão **Imprimir**, no alto da tela, ou **Imprimir mapa (prancha)**, no menu do seu nome.

A prancha junta duas partes:

- **Do próprio DWG:** moldura, título, quadro de cobertura, legenda de recepção via satélite, Grande São Paulo, Brasília/Brazlândia, carimbo e logotipo.
- **Do cadastro atual:** estações, rótulos, linhas de divisão, nomes das áreas e a linha “Atualização”.

Estações que não mudaram saem com o símbolo e o rótulo originais do DWG. Estações novas ou alteradas saem no mesmo padrão.

Escolha o papel, de A4 a A0, e confira quem atualizou e a data. Depois clique em **Imprimir / salvar PDF**. Na janela de impressão, escolha orientação paisagem e margens “Nenhuma”. **Baixar SVG** gera o desenho em vetor, que abre no Inkscape, Illustrator ou CorelDRAW.

Toda alteração fica registrada com o nome de quem fez e a data. Para consultar, use **Histórico de alterações**, no menu do seu nome, ou **Ver histórico desta estação**, na ficha de cada estação.

## Redes SFN

Cada estação mostra a rede SFN (Single Frequency Network) a que pertence, conforme o “Mapa de rotas – SFN”: canal físico (CF), canal virtual (CV) e a cidade principal da rede, por exemplo “38D CV10.1 – Campinas”.

- **Ficha:** a linha **Rede SFN** mostra a rede e quantas estações ela tem.
- **Mapa:** o botão **SFN**, ao lado de Área e Recepção, pinta cada rede de uma cor e desenha as divisões e os círculos CF/CV do mapa SFN. Clicando numa estação, as outras redes ficam apagadas e a legenda lista as estações da rede.
- **Divisões SFN:** as linhas vermelhas são calculadas a partir das estações: cada ponto do estado fica com a rede da estação mais próxima, e a fronteira entre duas redes vira linha. As linhas fecham na divisa do estado, cada rede ganha um fundo da sua cor e o círculo CF/CV fica no meio da região dela. Quando uma estação muda de rede ou de posição, as linhas mudam sozinhas. Na legenda dá para trocar para as linhas originais do mapa SFN (PDF).
- **Quantas estações em cada rede:** no modo SFN a legenda lista todas as redes com o número de estações, da maior para a menor; clicar numa rede destaca ela no mapa e mostra os nomes. O círculo CF/CV de cada rede mostra também “N est.”, e a lista da esquerda fica agrupada por rede, com o total de cada uma.
- **Tabela:** tem a coluna **Rede SFN**.
- **Impressão do mapa SFN:** em **Imprimir**, escolha **Mapa: Redes SFN** (já vem marcado quando o mapa está no modo SFN). A prancha sai igual ao “Mapa de rotas – SFN”: mesma moldura e estações, título “( SFN )”, linhas vermelhas das redes e os círculos CF/CV, colocados em lugares livres de cada rede. Papel A4 a A0, PDF ou SVG.
- **Busca:** aceita, por exemplo, “sfn 38D” ou “sfn Campinas”.
- **Edição:** o campo **Rede SFN** fica no formulário da estação, com sugestões das redes existentes.

Na primeira vez que o sistema atualizado inicia, ele preenche a rede SFN das estações a partir de `data/sfn.json`, sem apagar o que já tiver sido editado.

## Manutenções do Grafana (estações sem visita há mais de 120 dias)

O sistema pode ler o painel **Manutenções Rede** do Grafana, a tabela “Estações - Efetuar Visitadas”, uma vez por hora (e logo que o sistema inicia). Para ler na hora, use **Salvar e ler agora** em Manutenções (Grafana). As estações sem manutenção há mais de 120 dias, ou que nunca tiveram manutenção, ganham um **!** vermelho no mapa. A ficha mostra os dias, a data da última visita e a classe de prioridade. No painel da esquerda, o filtro **Sem manutenção +120 dias** mostra só essas estações.

Na instalação e em cada atualização, o instalador já coloca sozinho o endereço do painel (`http://monitorrede.tvcultura.com.br:3000/d/7owPaMFvz/manutencoes-rede?orgId=1`), testa o acesso e grava em `/etc/rede-tv-cultura.env`. A chave de API só é pedida se o Grafana exigir login. Para refazer só essa parte: `sudo /opt/rede-tv-cultura/deploy/grafana-setup.sh`. Em instalação sem terminal, use `bash -s -- --grafana-url URL --grafana-token CHAVE` (ou `--sem-grafana` para pular).

Desde a versão 2.10.4 isso funciona **sem chave**: o Grafana da rede libera leitura sem login, e o servidor lê o painel como visitante assim que inicia. Se o Grafana passar a exigir login, ou para usar uma chave mesmo assim:

1. No Grafana, entre como administrador e abra **Configuration (engrenagem) → API keys → Add API key**. Use o perfil **Viewer** e deixe sem validade. Copie a chave.
2. No mapa, abra o menu do seu nome e depois **Manutenções (Grafana)**. Esta opção só aparece para o perfil Admin.
3. O endereço e o código do painel já vêm preenchidos. Cole a chave e clique em **Salvar e ler agora**.

Na mesma tela dá para:

- mudar o limite de dias;
- escolher as colunas;
- ver as cidades do Grafana que não têm estação no mapa.

Se não houver chave, exporte a tabela no Grafana (**Inspect → Data → Download CSV**) e use **Carregar CSV**.

O servidor precisa alcançar o Grafana pela rede (`http://monitorrede.tvcultura.com.br:3000`). A chave também pode ficar em `/etc/rede-tv-cultura.env`, como `GRAFANA_TOKEN=...`.

## Estações no ar (telemetria do Grafana)

O sistema lê o **Dashboard Estações** do Grafana (`http://172.20.0.250:3000/d/fKcYfojvz/dashboard-estacoes`), que mostra a potência direta de cada transmissor pelo Zabbix, a cada 5 minutos. Cada estação fica:

- **No ar:** medidor na faixa verde;
- **Potência baixa:** medidor na faixa vermelha;
- **Sem dados**, **Visita técnica** ou **Telemetria a instalar:** o aviso que o painel mostra quando não há valor;
- **Sem telemetria:** a estação não tem medidor no painel.

No mapa, o botão **No ar** pinta as estações por essa situação. O painel da esquerda tem a seção **Transmissores · telemetria**, com a contagem de cada situação (clique para filtrar) e o link para o Dashboard Estações. A ficha da estação mostra a linha **Transmissor**, com a potência e há quanto tempo foi lida.

Esse Grafana pede login, então o servidor precisa de um **token de conta de serviço** com perfil Viewer: no Grafana, **Administration → Service accounts → Add service account** (perfil Viewer) e depois **Add service account token**. O instalador pede esse token (e já coloca o endereço sozinho). Se o token já tiver sido colado na página do mapa, o instalador aproveita ele e grava também em `/etc/rede-tv-cultura.env`, então reinstalar ou atualizar não perde a configuração; também dá para colar em **Telemetria (estações no ar)**, no menu do seu nome (perfil Admin). Medidores com nome diferente da estação podem ser ligados nessa mesma tela (“título do medidor = estação”). O Raspberry precisa estar na rede que alcança `172.20.0.250`.

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
| `--grafana-url URL` | Outro endereço do Grafana ou do painel (padrão `http://monitorrede.tvcultura.com.br:3000/d/7owPaMFvz`) |
| `--grafana-token CHAVE` | Chave de API do Grafana (perfil Viewer), sem perguntar |
| `--sem-grafana` | Não pergunta nem testa o acesso ao Grafana das manutenções |
| `--telemetria-token T` | Token do Grafana do Dashboard Estações (172.20.0.250), sem perguntar |
| `--sem-telemetria` | Não configura o Dashboard Estações (estações no ar) |

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
