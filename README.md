# Rede TV Cultura SP

Mapa interativo e cadastro das estações de repetição e retransmissão da TV Cultura (Fundação Padre Anchieta) no estado de São Paulo, organizado pela **Nova Divisão 2026** das equipes de manutenção.

O visual segue a linha de um console de satélites (estilo Satbeams). A página tem:

- mapa em tela cheia;
- painel lateral com filtros por área/equipe e por tipo;
- ficha flutuante da estação;
- "mancha de cobertura" ligando as cidades atendidas por cada estação;
- aba Tabela.

## Conteúdo

| Caminho | O que é |
|---|---|
| `index.html` | A página completa (HTML, CSS e JS num arquivo só). |
| `data/estacoes.json` | Cadastro das estações, uma entrada por estação (veja o formato abaixo). |
| `data/geometria.json` | Desenho do mapa extraído do DWG: contorno do estado, linhas de divisão, polígonos das áreas e posição aproximada dos municípios. Já vem embutido no `index.html`; o arquivo fica aqui como fonte. |
| `scripts/extracao/` | Scripts Python usados para ler o DWG e cruzar com a planilha (veja abaixo). |

## Como usar

**Dentro do claude.ai.** A página publicada como artefato usa o banco de dados do próprio artefato. Quem tem acesso de Colaborador ou Editor pode:

- incluir estações;
- editar estações;
- mudar a posição de uma estação no mapa;
- excluir estações;
- exportar o cadastro em CSV.

As alterações aparecem na hora para todos que estão com a página aberta.

**Fora do claude.ai** (GitHub Pages ou servidor local). A página entra em modo somente leitura e carrega `data/estacoes.json`. Para testar localmente:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Abrir o `index.html` direto pelo explorador de arquivos (`file://`) não funciona, porque o navegador bloqueia a leitura do JSON. Use um servidor, mesmo que local.

Para publicar no GitHub Pages: em *Settings → Pages*, escolha a branch `main` e a pasta raiz.

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
| `upd`, `by` | Data e autor da última edição feita pela página |

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
