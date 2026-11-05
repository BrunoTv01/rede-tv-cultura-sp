# Rede TV Cultura SP

Mapa interativo e cadastro das estações de repetição e retransmissão da TV Cultura (Fundação Padre Anchieta) no estado de São Paulo, organizado pela **Nova Divisão 2026** das equipes de manutenção.

O visual segue a linha de um console de satélites (estilo Satbeams). A página tem:

- mapa em tela cheia;
- painel lateral com filtros por área/equipe e por tipo;
- ficha flutuante da estação;
- "mancha de cobertura" ligando as cidades atendidas por cada estação;
- aba Tabela.

## Instalar num servidor Linux da rede interna

A versão completa roda num servidor próprio, com banco PostgreSQL, login (perfis Leitura, Editor e Admin) e histórico de alterações. Instala com um comando:

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/rede-tv-cultura-sp/main/instalar.sh | sudo bash
```

Depois abra `http://IP-DO-SERVIDOR:3100` e entre com **admin** / **admin**. O sistema pede uma senha nova no primeiro acesso. O passo a passo completo, com backup, atualização, Docker e instalação sem internet, está em **[INSTALL.md](INSTALL.md)**.

## Versão só para consulta (sem servidor)

O `index.html` da raiz abre o mapa em modo somente leitura, com os dados de `data/estacoes.json`:

- **Como site:** https://raw.githack.com/BrunoTv01/rede-tv-cultura-sp/main/index.html
- **No GitHub Pages:** ligue em *Settings → Pages → Deploy from a branch → main / root*, e o endereço passa a ser https://brunotv01.github.io/rede-tv-cultura-sp/

Para abrir no próprio computador, use um servidor local (`python3 -m http.server 8000`). Abrir o arquivo direto pelo explorador (`file://`) não funciona.

## Conteúdo

| Caminho | O que é |
|---|---|
| `server.js`, `auth.js` | Servidor (Node.js + Express): API das estações, login, usuários e histórico |
| `public/index.html` | A página do sistema instalado (mapa, tabela, edição, usuários, histórico) |
| `db/` | Esquema do banco e descoberta automática do PostgreSQL |
| `deploy/` | Instalador, atualização, backup, recuperação de senha, remoção, serviço systemd e nginx |
| `instalar.sh` | Instalação e atualização num comando só (baixa do GitHub) |
| `Dockerfile`, `docker-compose.yml` | Instalação com Docker |
| `data/estacoes.json` | Carga inicial das estações (usada quando o banco está vazio) |
| `data/geometria.json` | Desenho do mapa extraído do DWG: contorno, linhas de divisão, áreas e posição aproximada dos municípios |
| `index.html` | Versão só para consulta, sem servidor (GitHub Pages) |
| `scripts/extracao/` | Scripts Python usados para ler o DWG e cruzar com a planilha |

## Formato de `data/estacoes.json`

Objeto em que a chave é o id da estação e o valor tem estes campos:

| Campo | Significado |
|---|---|
| `n` | Nome da estação |
| `mu` | Município |
| `a` | Área/equipe: `1` Equipe SP1, `5` Equipe Costa Norte (Área 1), `2` Equipe SP2, `3` Saile Telecom (Elias), `4` Alexandre Cosme |
| `ch`, `vt` | Canal físico e canal virtual, como no DWG |
| `cf`, `cv` | Canal físico e virtual, como na planilha (quando diferem do DWG, a ficha mostra os dois) |
| `r` | Recepção: `R` satélite/retransmissão, `N` Costa Norte, `J` TV Jornal, `X` sem operação, `G` complemento da geradora (gap filler), `H` geradora, `P` repetidora, `F` gap filler |
| `pm` | `1` = canal PM / licença da prefeitura |
| `m` | Canal/manutenção: `full` FPA·FPA, `half` FPA·PM, `line` PM·FPA, `cross` PM·licença/PM |
| `pop`, `pot`, `en`, `ag`, `ab` | População, potência do transmissor e custeio de energia, água e abrigo (planilha) |
| `cov` | Cidades cobertas: lista de `[nome, população]` |
| `x`, `y` | Posição no sistema de coordenadas do DWG |
| `lx`, `ly`, `ll` | Posição e linhas do rótulo original do DWG; ficam vazios quando a estação é editada ou movida |
| `lat`, `lon` | Centro do município, usado no link do Google Maps |
| `upd`, `by` | Data e usuário da última edição (preenchidos pelo servidor) |

## Como os dados foram montados

Os arquivos originais (DWG e PDF do mapa “Nova Divisão” e a planilha “Projeto 100%” de 02/10/2026) são internos da FPA e não estão neste repositório. Para refazer a extração, coloque-os numa pasta `fontes/`, que é ignorada pelo Git.


1. **Leitura do DWG.** O DWG (AutoCAD 2018) foi convertido para JSON com o LibreDWG (`dwgread -O JSON`).
2. **Estações e atributos** (`extract.py`, `classify.py`, `final.py`):
   - cada estação é um triângulo de 3 vértices no desenho;
   - o rótulo de cada estação (nome, canal, VT) foi associado ao símbolo mais próximo por atribuição ótima (algoritmo húngaro);
   - a recepção vem das camadas e cores do símbolo;
   - o tipo de canal/manutenção vem do círculo interno do símbolo.
3. **Desenho e áreas** (`geom.py`, `area.py`, `build_final.py`):
   - o contorno do estado e as linhas vermelhas de divisão vêm das camadas do DWG;
   - a área de cada estação sai de um preenchimento por região delimitado pelas linhas vermelhas.
4. **Georreferenciamento** (`georef.py`): uma transformação afim liga as coordenadas do DWG a latitude/longitude. O erro mediano é de cerca de 6 km, porque o desenho é esquemático.
5. **Planilha** (`merge_planilha.py`): a planilha “Projeto 100%” trouxe população, potência, custeio e a coluna “Cobertura feita por”, que define as cidades de cada estação.

Os scripts estão aqui como registro do processo. Eles usam caminhos de trabalho fixos e precisam de ajuste para rodar de novo.

## Pendências conhecidas

- **5 transmissores estão na planilha, mas não no DWG,** e foram posicionados de forma aproximada: Iacanga, Ibiúna, Jacupiranga, Porangaba e Santa Maria da Serra.
- **4 canais físicos diferem entre o DWG e a planilha:** Ribeira, Angatuba, Avaré e Rinópolis.
- **Mogi Guaçu** aparece sem operação no DWG e com transmissor ativo na planilha.
- **A posição das cidades na mancha de cobertura é aproximada.**
