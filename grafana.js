// Rede TV Cultura SP · leitura do painel "Manutenções Rede" do Grafana
//
// O servidor (que fica na rede interna, junto do Grafana) lê a tabela de um painel pela API do Grafana,
// com um token de conta de serviço (perfil Viewer). O admin escolhe, na página, qual coluna é a estação,
// qual é a classe de prioridade e quais valores marcam "sem manutenção há mais de N dias".
// Também dá para carregar a tabela exportada do Grafana em CSV (Inspect → Data → Download CSV).
//
// Configuração: tabela config, chave 'grafana'. Variáveis de ambiente (em /etc/rede-tv-cultura.env)
// têm prioridade: GRAFANA_URL, GRAFANA_TOKEN, GRAFANA_DASHBOARD, GRAFANA_PANEL.

const INTERVALO_MS = 15 * 60 * 1000;

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nkey = s => norm(s).replace(/[^a-z0-9]/g, '');

module.exports = function grafana({ app, pool, requireRole, audit }) {
  let cache = { atualizado: null, erro: null, origem: null, colunas: [], linhas: [], paineis: [] };
  let timer = null;

  async function lerConfig() {
    const { rows } = await pool.query("SELECT valor FROM config WHERE chave='grafana'");
    const c = rows.length ? rows[0].valor : {};
    return {
      url: (process.env.GRAFANA_URL || c.url || '').replace(/\/+$/, ''),
      token: process.env.GRAFANA_TOKEN || c.token || '',
      dashboard: process.env.GRAFANA_DASHBOARD || c.dashboard || '',
      panel: process.env.GRAFANA_PANEL || c.panel || '',
      colEstacao: c.colEstacao || '', colPrioridade: c.colPrioridade || '', colData: c.colData || '',
      valores: Array.isArray(c.valores) ? c.valores : [], dias: +c.dias || 100,
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
  async function gf(c, method, p, body) {
    const r = await fetch(c.url + p, {
      method, headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    const txt = await r.text();
    if (!r.ok) {
      const msg = r.status === 401 ? 'o Grafana recusou o token (401). Confira o token da conta de serviço.'
        : r.status === 403 ? 'o token não tem permissão para este painel (403). Dê o perfil Viewer à conta de serviço.'
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
  const dsCache = new Map();
  async function dsRef(c, ref, vars) {
    if (ref && typeof ref === 'object' && ref.uid) {
      let uid = trocaVars(ref.uid, vars);
      if (uid.startsWith('$')) uid = (vars[uid.replace(/^\$\{?|\}$/g, '')] || {}).ds || uid;
      if (!uid.startsWith('$') && !/^-- /.test(uid)) return { uid, type: ref.type };
      ref = uid;
    }
    if (typeof ref === 'string' && ref) {
      let name = trocaVars(ref, vars);
      if (name.startsWith('$')) name = (vars[name.replace(/^\$\{?|\}$/g, '')] || {}).ds || name;
      if (dsCache.has(name)) return dsCache.get(name);
      let ds;
      try { ds = await gf(c, 'GET', '/api/datasources/uid/' + encodeURIComponent(name)); }
      catch { ds = await gf(c, 'GET', '/api/datasources/name/' + encodeURIComponent(name)); }
      const out = { uid: ds.uid, type: ds.type }; dsCache.set(name, out); return out;
    }
    const def = await gf(c, 'GET', '/api/datasources').then(l => l.find(d => d.isDefault) || l[0]);
    if (!def) throw new Error('não achei nenhuma fonte de dados no Grafana.');
    return { uid: def.uid, type: def.type };
  }
  // devolve as colunas e linhas das tabelas (frames) do painel
  async function consultarPainel(c, dash, panel) {
    const vars = variaveis(dash);
    const queries = [];
    for (const t of panel.targets || []) {
      if (t.hide) continue;
      const ds = await dsRef(c, t.datasource && !(typeof t.datasource === 'object' && /^-- (Mixed|Dashboard) --$/.test(t.datasource.uid)) ? t.datasource : panel.datasource, vars);
      queries.push({ ...trocaVarsObj(t, vars), datasource: ds, intervalMs: 60000, maxDataPoints: 5000 });
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
    if (!c.url || !c.token || !c.dashboard) { if (cache.origem !== 'csv') cache.erro = null; return cache; }
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
        const cand = ps.filter(p => /table/.test(p.type)).concat(ps.filter(p => !/table/.test(p.type)));
        for (const p of cand.slice(0, 12)) {
          try { const t = await consultarPainel(c, dash, p); if (t.colunas.some(x => /priorid/i.test(norm(x)))) { tab = t; alvo = p; break; } if (!tab && t.linhas.length) { tab = t; alvo = p; } } catch { /* tenta o próximo */ }
        }
        if (!tab) throw new Error('não achei no dashboard um painel com tabela. Escolha o painel na configuração.');
      }
      cache = { ...cache, ...tab, atualizado: new Date().toISOString(), erro: null, origem: 'grafana', painelUsado: alvo ? { id: alvo.id, titulo: alvo.title } : null };
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
    return { colEstacao: acha(/esta[cç]?ao|estacao|site|localidade|^local|nome|cidade|municipio/), colPrioridade: acha(/priorid/), colData: acha(/ultima|data|manuten|visita/) };
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
    const colE = c.colEstacao || g.colEstacao, colP = c.colPrioridade || g.colPrioridade, colD = c.colData || '';
    const { rows } = await pool.query('SELECT id, data FROM estacoes');
    const idx = new Map();
    for (const r of rows) for (const k of [r.data.n, r.data.mu]) { const kk = nkey(k); if (kk && !idx.has(kk)) idx.set(kk, r.id); }
    for (const [nome, id] of Object.entries(c.apelidos)) idx.set(nkey(nome), id);
    const acharEstacao = nome => {
      const k = nkey(nome); if (!k) return null;
      if (idx.has(k)) return idx.get(k);
      // "Campinas - SP", "RTV Campinas", "Campinas (Gap Filler)"...
      const base = nkey(String(nome).split(/[-–(/|]/)[0]);
      if (base && idx.has(base)) return idx.get(base);
      for (const [kk, id] of idx) if (kk.length >= 5 && (k.includes(kk) || kk.includes(k))) return id;
      return null;
    };
    const itens = {}, semEstacao = [];
    if (!colE) return { itens, semEstacao, colE, colP, colD, dias: c.dias };
    for (const row of cache.linhas) {
      const nome = row[colE]; if (nome === null || nome === undefined || nome === '') continue;
      const id = acharEstacao(nome);
      const prio = colP ? String(row[colP] ?? '').trim() : '';
      const dias = colD ? diasDesde(row[colD]) : null;
      const porValor = prio && c.valores.some(v => norm(v) === norm(prio));
      const porData = dias !== null && dias > c.dias;
      if (!id) { if (porValor || porData) semEstacao.push(String(nome)); continue; }
      const it = itens[id] || (itens[id] = { nome: String(nome), prio: '', dias: null, alerta: false });
      if (prio && !it.prio) it.prio = prio;
      if (dias !== null && (it.dias === null || dias < it.dias)) it.dias = dias;
      if (porValor || porData) it.alerta = true;
    }
    return { itens, semEstacao: [...new Set(semEstacao)], colE, colP, colD, dias: c.dias };
  }

  /* ---------- rotas ---------- */
  app.get('/api/manutencao', requireRole('viewer'), async (_req, res, next) => {
    try {
      const x = await cruzar();
      const alertas = {}; for (const [id, it] of Object.entries(x.itens)) if (it.alerta) alertas[id] = it;
      res.json({ atualizado: cache.atualizado, erro: cache.erro, origem: cache.origem, dias: x.dias, alertas, total: Object.keys(alertas).length });
    } catch (e) { next(e); }
  });
  app.get('/api/grafana/config', requireRole('admin'), async (_req, res, next) => {
    try {
      const c = await lerConfig(); const x = await cruzar();
      const valores = x.colP ? [...new Set(cache.linhas.map(r => String(r[x.colP] ?? '').trim()).filter(Boolean))].slice(0, 60) : [];
      res.json({
        url: c.url, dashboard: c.dashboard, panel: c.panel, temToken: !!c.token, envFixo: c.envFixo,
        colEstacao: x.colE, colPrioridade: x.colP, colData: x.colD, valores: c.valores, dias: c.dias,
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
        valores: Array.isArray(b.valores) ? b.valores.slice(0, 40).map(v => s(v, 120)) : old.valores,
        dias: b.dias !== undefined ? Math.min(3650, Math.max(1, Math.round(+b.dias || 100))) : old.dias,
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
