// Rede TV Cultura SP · leitura do painel "Manutenções Rede" do Grafana
//
// O servidor (que fica na rede interna, junto do Grafana) lê a tabela de um painel pela API do Grafana,
// com um token de conta de serviço (perfil Viewer). O admin escolhe, na página, qual coluna é a estação,
// qual é a classe de prioridade e quais valores marcam "sem manutenção há mais de N dias".
// Também dá para carregar a tabela exportada do Grafana em CSV (Inspect → Data → Download CSV).
//
// Configuração: tabela config, chave 'grafana'. Variáveis de ambiente (em /etc/rede-tv-cultura.env)
// têm prioridade: GRAFANA_URL, GRAFANA_TOKEN, GRAFANA_DASHBOARD, GRAFANA_PANEL.

const INTERVALO_MS = 60 * 60 * 1000; // lê o Grafana uma vez por hora

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nkey = s => norm(s).replace(/[^a-z0-9]/g, '');
// segunda chance para grafias diferentes: Luiz/Luís, Sta./Santa, Sto./Santo
const nkey2 = s => nkey(String(s ?? '').replace(/\bSta\.?\s/gi, 'Santa ').replace(/\bSto\.?\s/gi, 'Santo ')).replace(/z/g, 's').replace(/y/g, 'i');

module.exports = function grafana({ app, pool, requireRole, audit }) {
  let cache = { atualizado: null, erro: null, origem: null, colunas: [], linhas: [], paineis: [] };
  let timer = null;

  async function lerConfig() {
    const { rows } = await pool.query("SELECT valor FROM config WHERE chave='grafana'");
    const c = rows.length ? rows[0].valor : {};
    return {
      url: (process.env.GRAFANA_URL || c.url || 'http://monitorrede.tvcultura.com.br:3000').replace(/\/+$/, ''),
      token: process.env.GRAFANA_TOKEN || c.token || '',
      dashboard: process.env.GRAFANA_DASHBOARD || c.dashboard || '7owPaMFvz',
      panel: process.env.GRAFANA_PANEL || c.panel || '',
      colEstacao: c.colEstacao || '', colPrioridade: c.colPrioridade || '', colDias: c.colDias || '', colData: c.colData || '', colStatus: c.colStatus || '',
      valores: Array.isArray(c.valores) ? c.valores : ['maxima'], dias: +c.dias || 120, nunca: c.nunca !== false,
      apelidos: c.apelidos && typeof c.apelidos === 'object' ? c.apelidos : {},
      envFixo: { url: !!process.env.GRAFANA_URL, token: !!process.env.GRAFANA_TOKEN, dashboard: !!process.env.GRAFANA_DASHBOARD, panel: !!process.env.GRAFANA_PANEL },
    };
  }
  async function gravarConfig(c, user) {
    await pool.query(`INSERT INTO config (chave, valor, updated_at, updated_by) VALUES ('grafana', $1, now(), $2)
      ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor, updated_at=now(), updated_by=EXCLUDED.updated_by`, [c, user]);
  }
  async function lerCache() {
    const { rows } = await pool.query("SELECT valor FROM config WHERE chave='grafana_dados'");
    if (rows.length) cache = { ...cache, ...rows[0].valor };
  }
  async function gravarCache() {
    const { atualizado, erro, origem, colunas, linhas, paineis } = cache;
    await pool.query(`INSERT INTO config (chave, valor, updated_at, updated_by) VALUES ('grafana_dados', $1, now(), 'servidor')
      ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor, updated_at=now()`, [{ atualizado, erro, origem, colunas, linhas: linhas.slice(0, 3000), paineis }]);
  }

  /* ---------- API do Grafana ---------- */
  // usa a chave de API quando houver; se não houver (ou se o Grafana recusar a chave), tenta o acesso
  // anônimo, que o Grafana da rede libera para leitura dos painéis
  let anonimo = false;
  async function gf(c, method, p, body) {
    const ir = auth => fetch(c.url + p, {
      method, headers: { ...(auth ? { Authorization: 'Bearer ' + c.token } : {}), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    let r = await ir(!!c.token && !anonimo);
    if ((r.status === 401 || r.status === 403) && c.token && !anonimo) { const r2 = await ir(false); if (r2.ok) { anonimo = true; r = r2; } }
    const txt = await r.text();
    if (!r.ok) {
      const msg = r.status === 401 ? (c.token ? 'o Grafana recusou a chave de API (401). Confira a chave cadastrada.' : 'o Grafana pediu login (401). Cadastre uma chave de API (perfil Viewer).')
        : r.status === 403 ? 'a chave de API não tem permissão para este painel (403). Crie a chave com o perfil Viewer na mesma organização do painel.'
        : r.status === 404 ? 'endereço não encontrado no Grafana (404). Confira o código do painel.'
        : `o Grafana respondeu ${r.status}: ${txt.slice(0, 200)}`;
      throw new Error(msg);
    }
    try { return JSON.parse(txt); } catch { throw new Error('o Grafana não devolveu JSON. Confira o endereço.'); }
  }
  const todosPaineis = list => (list || []).flatMap(p => [p, ...todosPaineis(p.panels)]);
  function variaveis(dash) {
    const v = {};
    for (const t of (dash.templating && dash.templating.list) || []) {
      const cur = t.current || {};
      let val = cur.value ?? cur.text;
      if (Array.isArray(val)) val = val.filter(x => x !== '$__all').join(',');
      if (val === '$__all' || val === undefined) val = '';
      v[t.name] = { val: String(val), tipo: t.type, ds: t.type === 'datasource' ? String(cur.value || cur.text || '') : null };
    }
    return v;
  }
  const trocaVars = (s, vars) => typeof s !== 'string' ? s
    : s.replace(/\$\{(\w+)(?::\w+)?\}|\[\[(\w+)\]\]|\$(\w+)/g, (m, a, b, c) => { const k = a || b || c; return vars[k] ? vars[k].val : m; });
  function trocaVarsObj(o, vars) {
    if (typeof o === 'string') return trocaVars(o, vars);
    if (Array.isArray(o)) return o.map(x => trocaVarsObj(x, vars));
    if (o && typeof o === 'object') { const r = {}; for (const k in o) r[k] = trocaVarsObj(o[k], vars); return r; }
    return o;
  }
  // fontes de dados: /api/frontend/settings funciona com chave de perfil Viewer (a API /api/datasources pede Admin)
  let dsLista = null;
  async function fontes(c) {
    if (dsLista) return dsLista;
    const fs = await gf(c, 'GET', '/api/frontend/settings');
    dsLista = { porNome: fs.datasources || {}, padrao: fs.defaultDatasource || '' };
    setTimeout(() => { dsLista = null; }, 3600 * 1000).unref?.();
    return dsLista;
  }
  async function dsRef(c, ref, vars) {
    const L = await fontes(c);
    const resolve = v => { v = trocaVars(String(v || ''), vars); if (v.startsWith('$')) v = (vars[v.replace(/^\$\{?|\}$/g, '')] || {}).ds || v; return v; };
    let chave = ref && typeof ref === 'object' ? resolve(ref.uid) : resolve(ref);
    if (!chave || /^default$/i.test(chave)) chave = L.padrao;
    let ds = L.porNome[chave] || Object.values(L.porNome).find(d => d.uid === chave);
    if (!ds) throw new Error(`não achei a fonte de dados "${chave}" no Grafana.`);
    return { uid: ds.uid, type: ds.type, id: ds.id };
  }
  // devolve as colunas e linhas das tabelas (frames) do painel
  async function consultarPainel(c, dash, panel) {
    const vars = variaveis(dash);
    const queries = [];
    for (const t of panel.targets || []) {
      if (t.hide) continue;
      const ds = await dsRef(c, t.datasource && !(typeof t.datasource === 'object' && /^-- (Mixed|Dashboard) --$/.test(t.datasource.uid)) ? t.datasource : panel.datasource, vars);
      queries.push({ ...trocaVarsObj(t, vars), datasource: { uid: ds.uid, type: ds.type }, datasourceId: ds.id, intervalMs: 60000, maxDataPoints: 5000 });
    }
    if (!queries.length) throw new Error(`o painel "${panel.title}" não tem consultas.`);
    const time = dash.time || {};
    const r = await gf(c, 'POST', '/api/ds/query', { queries, from: String(time.from || 'now-1y'), to: String(time.to || 'now') });
    const frames = Object.values(r.results || {}).flatMap(x => { if (x.error) throw new Error('erro na consulta do painel: ' + x.error); return x.frames || []; });
    return framesParaTabela(frames);
  }
  function framesParaTabela(frames) {
    let colunas = [], linhas = [];
    for (const f of frames) {
      const fields = (f.schema && f.schema.fields) || [];
      const vals = (f.data && f.data.values) || [];
      const nomes = fields.map((fl, i) => (fl.config && fl.config.displayNameFromDS) || fl.config?.displayName || fl.name || ('coluna ' + (i + 1)));
      const tipos = fields.map(fl => fl.type);
      const n = vals[0] ? vals[0].length : 0;
      nomes.forEach(nm => { if (!colunas.includes(nm)) colunas.push(nm); });
      for (let i = 0; i < n; i++) {
        const row = {};
        nomes.forEach((nm, j) => { let v = vals[j] ? vals[j][i] : null; if (tipos[j] === 'time' && typeof v === 'number') v = new Date(v).toISOString(); row[nm] = v; });
        linhas.push(row);
      }
    }
    return { colunas, linhas };
  }

  /* ---------- sincronização ---------- */
  async function sincronizar() {
    const c = await lerConfig();
    if (!c.url || !c.dashboard) { if (cache.origem !== 'csv') cache.erro = null; return cache; }
    anonimo = false;
    try {
      const d = await gf(c, 'GET', '/api/dashboards/uid/' + encodeURIComponent(c.dashboard));
      const dash = d.dashboard || {};
      const ps = todosPaineis(dash.panels).filter(p => p.type !== 'row');
      cache.paineis = ps.map(p => ({ id: p.id, titulo: p.title || '(sem título)', tipo: p.type }));
      let alvo = c.panel ? ps.find(p => String(p.id) === String(c.panel) || norm(p.title) === norm(c.panel)) : null;
      if (c.panel && !alvo) throw new Error(`o painel "${c.panel}" não existe mais no dashboard.`);
      let tab = null;
      if (alvo) tab = await consultarPainel(c, dash, alvo);
      else {
        // sem painel escolhido: o primeiro cuja tabela tem uma coluna de prioridade
        const pri = p => (/table/.test(p.type) ? 0 : 2) + (/visit|manuten|priorid/i.test(norm(p.title)) ? 0 : 1);
        const cand = ps.slice().sort((a, b) => pri(a) - pri(b));
        for (const p of cand.slice(0, 12)) {
          try { const t = await consultarPainel(c, dash, p); if (t.colunas.some(x => /priorid/i.test(norm(x)))) { tab = t; alvo = p; break; } if (!tab && t.linhas.length) { tab = t; alvo = p; } } catch { /* tenta o próximo */ }
        }
        if (!tab) throw new Error('não achei no dashboard um painel com tabela. Escolha o painel na configuração.');
      }
      cache = { ...cache, ...tab, atualizado: new Date().toISOString(), erro: null, origem: 'grafana', painelUsado: alvo ? { id: alvo.id, titulo: alvo.title } : null };
      // guarda o painel achado, para não procurar de novo a cada leitura
      if (!c.panel && alvo) { const { rows } = await pool.query("SELECT valor FROM config WHERE chave='grafana'"); const v = rows.length ? rows[0].valor : {}; v.panel = String(alvo.id); await gravarConfig(v, 'servidor'); }
    } catch (e) {
      cache.erro = (e.name === 'TimeoutError' || e.cause) ? `não consegui falar com o Grafana em ${c.url} (${e.cause ? e.cause.code || e.cause.message : 'tempo esgotado'}).` : e.message;
    }
    await gravarCache();
    return cache;
  }
  function agendar() { clearInterval(timer); timer = setInterval(() => sincronizar().catch(() => {}), INTERVALO_MS); timer.unref && timer.unref(); }

  /* ---------- cruzamento com as estações ---------- */
  function adivinhar(colunas) {
    const acha = re => colunas.find(c => re.test(norm(c))) || '';
    return {
      colEstacao: acha(/^cidade$|^estacao$/) || acha(/esta[cç]?ao|estacao|site|localidade|^local|nome|cidade|municipio/),
      colPrioridade: acha(/classe.?priorid/) || acha(/priorid/),
      colDias: acha(/dias/), colStatus: acha(/status/), colData: acha(/ultima|data/),
    };
  }
  function diasDesde(v) {
    if (v === null || v === undefined || v === '') return null;
    let t = typeof v === 'number' ? (v > 1e11 ? v : v * 1000) : Date.parse(v);
    if (typeof v === 'string' && isNaN(t)) { const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) t = Date.UTC(+(m[3].length === 2 ? '20' + m[3] : m[3]), m[2] - 1, +m[1]); }
    return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
  }
  async function cruzar() {
    const c = await lerConfig();
    const g = adivinhar(cache.colunas);
    const colE = c.colEstacao || g.colEstacao, colP = c.colPrioridade || g.colPrioridade, colN = c.colDias || g.colDias,
      colS = c.colStatus || g.colStatus, colD = c.colData || g.colData;
    const { rows } = await pool.query('SELECT id, data FROM estacoes');
    const porNome = new Map(), porMun = new Map(), porNome2 = new Map(), porMun2 = new Map();
    for (const r of rows) {
      const kn = nkey(r.data.n), km = nkey(r.data.mu);
      if (kn && !porNome.has(kn)) porNome.set(kn, r.id);
      if (km) { if (!porMun.has(km)) porMun.set(km, []); porMun.get(km).push(r.id); }
      const kn2 = nkey2(r.data.n), km2 = nkey2(r.data.mu);
      if (kn2 && !porNome2.has(kn2)) porNome2.set(kn2, r.id);
      if (km2) { if (!porMun2.has(km2)) porMun2.set(km2, []); porMun2.get(km2).push(r.id); }
    }
    for (const [nome, id] of Object.entries(c.apelidos)) porNome.set(nkey(nome), id);
    // a linha do Grafana vale para a estação com esse nome; se não houver, para as estações desse município
    const acharEstacoes = nome => {
      for (const k of [nkey(nome), nkey(String(nome).split(/[-–(/|]/)[0])]) {
        if (!k) continue;
        if (porNome.has(k)) return [porNome.get(k)];
        if (porMun.has(k)) return porMun.get(k);
      }
      for (const k of [nkey2(nome), nkey2(String(nome).split(/[-–(/|]/)[0])]) {
        if (!k) continue;
        if (porNome2.has(k)) return [porNome2.get(k)];
        if (porMun2.has(k)) return porMun2.get(k);
      }
      return [];
    };
    const itens = {}, semEstacao = [];
    if (!colE) return { itens, semEstacao, colE, colP, colN, colS, colD, dias: c.dias };
    for (const row of cache.linhas) {
      const nome = row[colE]; if (nome === null || nome === undefined || nome === '') continue;
      const classe = colP ? String(row[colP] ?? '').trim() : '';
      let dias = colN && row[colN] !== null && row[colN] !== '' && row[colN] !== undefined && !isNaN(+row[colN]) ? Math.round(+row[colN]) : null;
      if (dias === null && colD) dias = diasDesde(row[colD]);
      const status = colS ? String(row[colS] ?? '').trim() : '';
      const nunca = /nunca/i.test(norm(status)) || (!dias && !row[colD] && /maxima/.test(norm(classe)));
      const alerta = (dias !== null && dias > c.dias) || (c.nunca && nunca) || (classe && c.valores.some(v => norm(v) === norm(classe)));
      const ids = acharEstacoes(nome);
      if (!ids.length) { if (alerta) semEstacao.push(String(nome)); continue; }
      for (const id of ids) {
        const it = itens[id] || (itens[id] = { nome: String(nome), classe: '', dias: null, ultima: null, nunca: false, alerta: false });
        if (classe && !it.classe) it.classe = classe;
        if (dias !== null && (it.dias === null || dias < it.dias)) it.dias = dias;
        if (colD && row[colD] && (!it.ultima || String(row[colD]) > it.ultima)) it.ultima = String(row[colD]);
        if (nunca) it.nunca = true;
        if (alerta) it.alerta = true;
      }
    }
    // regra final por estação (a mesma cidade pode aparecer em mais de uma linha, uma por equipe):
    // vale a manutenção mais recente
    for (const it of Object.values(itens)) {
      it.alerta = it.dias !== null ? it.dias > c.dias : (c.nunca && it.nunca);
      if (!it.alerta && it.dias === null && it.classe && c.valores.some(v => norm(v) === norm(it.classe))) it.alerta = true;
    }
    return { itens, semEstacao: [...new Set(semEstacao)], colE, colP, colN, colS, colD, dias: c.dias };
  }

  /* ---------- rotas ---------- */
  app.get('/api/manutencao', requireRole('viewer'), async (_req, res, next) => {
    try {
      const x = await cruzar();
      const alertas = {}; for (const [id, it] of Object.entries(x.itens)) if (it.alerta) alertas[id] = it;
      const c = await lerConfig();
      // link para abrir o painel no Grafana (cada pessoa entra com o próprio login do Grafana)
      const painel = c.panel || (cache.painelUsado && cache.painelUsado.id) || '';
      const link = c.url && c.dashboard ? `${c.url}/d/${encodeURIComponent(c.dashboard)}?orgId=1${painel ? '&viewPanel=' + encodeURIComponent(painel) : ''}` : null;
      res.json({ atualizado: cache.atualizado, erro: cache.erro, origem: cache.origem, dias: x.dias, alertas, itens: x.itens, total: Object.keys(alertas).length, configurado: !!(cache.linhas && cache.linhas.length), link, linkPainel: c.url && c.dashboard ? `${c.url}/d/${encodeURIComponent(c.dashboard)}?orgId=1` : null });
    } catch (e) { next(e); }
  });
  app.get('/api/grafana/config', requireRole('admin'), async (_req, res, next) => {
    try {
      const c = await lerConfig(); const x = await cruzar();
      const valores = x.colP ? [...new Set(cache.linhas.map(r => String(r[x.colP] ?? '').trim()).filter(Boolean))].slice(0, 60) : [];
      res.json({
        url: c.url, dashboard: c.dashboard, panel: c.panel, temToken: !!c.token, envFixo: c.envFixo,
        colEstacao: x.colE, colPrioridade: x.colP, colDias: x.colN, colStatus: x.colS, colData: x.colD, valores: c.valores, dias: c.dias, nunca: c.nunca,
        colunas: cache.colunas, valoresEncontrados: valores, paineis: cache.paineis || [], painelUsado: cache.painelUsado || null,
        amostra: cache.linhas.slice(0, 8), linhas: cache.linhas.length, atualizado: cache.atualizado, erro: cache.erro, origem: cache.origem,
        alertas: Object.values(x.itens).filter(i => i.alerta).length, semEstacao: x.semEstacao,
      });
    } catch (e) { next(e); }
  });
  app.put('/api/grafana/config', requireRole('admin'), async (req, res, next) => {
    try {
      const b = req.body || {}; const cur = await lerConfig();
      const { rows } = await pool.query("SELECT valor FROM config WHERE chave='grafana'");
      const old = rows.length ? rows[0].valor : {};
      const s = (v, m = 300) => String(v ?? '').trim().slice(0, m);
      const novo = {
        ...old,
        url: b.url !== undefined ? s(b.url) : old.url, dashboard: b.dashboard !== undefined ? s(b.dashboard, 80) : old.dashboard,
        panel: b.panel !== undefined ? s(b.panel, 120) : old.panel,
        token: b.token ? s(b.token, 400) : (b.limparToken ? '' : old.token),
        colEstacao: b.colEstacao !== undefined ? s(b.colEstacao, 120) : old.colEstacao,
        colPrioridade: b.colPrioridade !== undefined ? s(b.colPrioridade, 120) : old.colPrioridade,
        colData: b.colData !== undefined ? s(b.colData, 120) : old.colData,
        colDias: b.colDias !== undefined ? s(b.colDias, 120) : old.colDias,
        colStatus: b.colStatus !== undefined ? s(b.colStatus, 120) : old.colStatus,
        nunca: b.nunca !== undefined ? !!b.nunca : old.nunca,
        valores: Array.isArray(b.valores) ? b.valores.slice(0, 40).map(v => s(v, 120)) : old.valores,
        dias: b.dias !== undefined ? Math.min(3650, Math.max(1, Math.round(+b.dias || 120))) : old.dias,
      };
      if (novo.url && !/^https?:\/\//i.test(novo.url)) return res.status(400).json({ error: 'O endereço do Grafana precisa começar com http:// ou https://' });
      // o endereço do painel inteiro também serve: tira o código do dashboard dele
      const m = String(novo.url || '').match(/^(https?:\/\/[^/]+)(?:\/.*?)?\/d\/([^/?#]+)/i);
      if (m) { novo.url = m[1]; if (!novo.dashboard) novo.dashboard = m[2]; }
      await gravarConfig(novo, req.user.username);
      await audit('config', 'grafana', 'integração Grafana', null, `${novo.url || '-'} · painel ${novo.dashboard || '-'}`, 'Configuração alterada');
      if (b.sincronizar !== false && (novo.url !== cur.url || novo.dashboard !== cur.dashboard || novo.panel !== cur.panel || b.token)) await sincronizar();
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.post('/api/grafana/sincronizar', requireRole('admin'), async (_req, res, next) => {
    try { await sincronizar(); res.json({ ok: !cache.erro, erro: cache.erro, linhas: cache.linhas.length }); } catch (e) { next(e); }
  });
  // tabela exportada do Grafana (CSV), já lida pela página: { colunas, linhas }
  app.post('/api/grafana/csv', requireRole('admin'), async (req, res, next) => {
    try {
      const b = req.body || {};
      const colunas = Array.isArray(b.colunas) ? b.colunas.slice(0, 60).map(c => String(c).slice(0, 120)) : [];
      const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 3000).map(r => { const o = {}; colunas.forEach(c => { o[c] = r && r[c] !== undefined ? String(r[c]).slice(0, 300) : null; }); return o; }) : [];
      if (!colunas.length || !linhas.length) return res.status(400).json({ error: 'O arquivo não tem linhas.' });
      cache = { ...cache, colunas, linhas, atualizado: new Date().toISOString(), erro: null, origem: 'csv' };
      await gravarCache();
      await audit('config', 'grafana', 'tabela de manutenções', null, `${linhas.length} linhas (CSV)`, 'Arquivo carregado');
      res.json({ ok: true, linhas: linhas.length });
    } catch (e) { next(e); }
  });

  return {
    async iniciar() { await lerCache().catch(() => {}); sincronizar().catch(() => {}); agendar(); },
  };
};
