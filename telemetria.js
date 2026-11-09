// Rede TV Cultura SP · estações no ar (Grafana "Dashboard Estações", telemetria pelo Zabbix)
//
// O painel tem um medidor por estação com a potência direta do transmissor. O servidor lê todos os
// medidores de uma vez pela API do Grafana e classifica cada estação do jeito que o próprio painel pinta:
//   no ar (faixa verde) · potência baixa (faixa vermelha) · atenção (amarela/laranja)
//   sem dados / visita técnica / telemetria a instalar (texto que o painel mostra quando não há valor)
// Configuração: tabela config, chave 'telemetria'. Variáveis de ambiente (em /etc/rede-tv-cultura.env)
// têm prioridade: TELEMETRIA_URL, TELEMETRIA_TOKEN, TELEMETRIA_DASHBOARD.

const INTERVALO_MS = 5 * 60 * 1000; // o painel se atualiza a cada 5 minutos
const PADRAO_URL = 'http://172.20.0.250:3000';
const PADRAO_DASH = 'fKcYfojvz';

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nkey = s => norm(s).replace(/[^a-z0-9]/g, '');
const nkey2 = s => nkey(String(s ?? '').replace(/\bSta\.?\s/gi, 'Santa ').replace(/\bSto\.?\s/gi, 'Santo ')).replace(/z/g, 's').replace(/y/g, 'i');

const ROTULO = { ar: 'No ar', baixo: 'Potência baixa', atencao: 'Atenção', semdados: 'Sem dados', visita: 'Visita técnica', instalar: 'Telemetria a instalar' };

module.exports = function telemetria({ app, pool, requireRole, audit }) {
  let cache = { atualizado: null, erro: null, paineis: [] };
  let timer = null;

  async function lerConfig() {
    const { rows } = await pool.query("SELECT valor FROM config WHERE chave='telemetria'");
    const c = rows.length ? rows[0].valor : {};
    return {
      url: (process.env.TELEMETRIA_URL || c.url || PADRAO_URL).replace(/\/+$/, ''),
      token: process.env.TELEMETRIA_TOKEN || c.token || '',
      dashboard: process.env.TELEMETRIA_DASHBOARD || c.dashboard || PADRAO_DASH,
      apelidos: c.apelidos && typeof c.apelidos === 'object' ? c.apelidos : {},
      envFixo: { url: !!process.env.TELEMETRIA_URL, token: !!process.env.TELEMETRIA_TOKEN, dashboard: !!process.env.TELEMETRIA_DASHBOARD },
    };
  }
  async function gravarConfig(c, user) {
    await pool.query(`INSERT INTO config (chave, valor, updated_at, updated_by) VALUES ('telemetria', $1, now(), $2)
      ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor, updated_at=now(), updated_by=EXCLUDED.updated_by`, [c, user]);
  }
  async function lerCache() {
    const { rows } = await pool.query("SELECT valor FROM config WHERE chave='telemetria_dados'");
    if (rows.length) cache = { ...cache, ...rows[0].valor };
  }
  async function gravarCache() {
    await pool.query(`INSERT INTO config (chave, valor, updated_at, updated_by) VALUES ('telemetria_dados', $1, now(), 'servidor')
      ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor, updated_at=now()`, [cache]);
  }

  async function gf(c, method, p, body) {
    const ir = auth => fetch(c.url + p, {
      method, headers: { ...(auth ? { Authorization: 'Bearer ' + c.token } : {}), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    let r = await ir(!!c.token);
    if ((r.status === 401 || r.status === 403) && c.token) { const r2 = await ir(false); if (r2.ok) r = r2; }
    const txt = await r.text();
    if (!r.ok) {
      const msg = (r.status === 401 || r.status === 403)
        ? (c.token ? `o Grafana recusou a chave (${r.status}). Confira a chave cadastrada.` : `o Grafana pede login (${r.status}). Cadastre uma chave de conta de serviço (perfil Viewer).`)
        : r.status === 404 ? 'painel não encontrado no Grafana (404). Confira o código do dashboard.'
        : `o Grafana respondeu ${r.status}: ${txt.slice(0, 200)}`;
      throw new Error(msg);
    }
    try { return JSON.parse(txt); } catch { throw new Error('o Grafana não devolveu JSON. Confira o endereço.'); }
  }
  const todosPaineis = list => (list || []).flatMap(p => [p, ...todosPaineis(p.panels)]);

  // cor da faixa em que o valor cai, como o Grafana pinta o medidor
  function corDoValor(v, df) {
    const steps = (df.thresholds && df.thresholds.steps) || [];
    if (!steps.length) return v > 0 ? 'green' : 'red';
    let x = v;
    if (df.thresholds.mode === 'percentage') {
      const min = +df.min || 0, max = df.max === undefined || df.max === null ? null : +df.max;
      if (max === null || max === min) return v > 0 ? 'green' : 'red';
      x = (v - min) / (max - min) * 100;
    }
    let cor = steps[0].color;
    for (const s of steps) if (s.value === null || s.value === undefined || x >= s.value) cor = s.color;
    return String(cor || '');
  }
  function classificar(v, df) {
    if (v === null || v === undefined) {
      const t = norm(df.noValue || '');
      return /instal/.test(t) ? 'instalar' : /visita/.test(t) ? 'visita' : 'semdados';
    }
    const cor = norm(corDoValor(v, df));
    return /green/.test(cor) ? 'ar' : /red/.test(cor) ? 'baixo' : /yellow|orange/.test(cor) ? 'atencao' : 'ar';
  }

  async function dsDe(c, ref, cacheDs) {
    if (ref && typeof ref === 'object' && ref.uid) return { uid: ref.uid, type: ref.type };
    if (!cacheDs.fs) cacheDs.fs = await gf(c, 'GET', '/api/frontend/settings');
    const L = cacheDs.fs.datasources || {}; const nome = !ref || /^default$/i.test(ref) ? cacheDs.fs.defaultDatasource : ref;
    const d = L[nome] || Object.values(L).find(x => x.uid === nome);
    if (!d) throw new Error(`não achei a fonte de dados "${nome}" no Grafana.`);
    return { uid: d.uid, type: d.type, id: d.id };
  }

  async function sincronizar() {
    const c = await lerConfig();
    if (!c.url || !c.dashboard) { cache.erro = null; return cache; }
    try {
      const d = await gf(c, 'GET', '/api/dashboards/uid/' + encodeURIComponent(c.dashboard));
      const dash = d.dashboard || {};
      const ps = todosPaineis(dash.panels).filter(p => /gauge|stat|bargauge/.test(p.type) && (p.targets || []).length);
      const queries = [], dono = {}, dsCache = {};
      for (const [i, p] of ps.entries()) {
        for (const [k, t] of (p.targets || []).entries()) {
          if (t.hide) continue;
          const ds = await dsDe(c, t.datasource && !(typeof t.datasource === 'object' && /^-- (Mixed|Dashboard) --$/.test(t.datasource.uid)) ? t.datasource : p.datasource, dsCache);
          const refId = `p${i}_${k}`; dono[refId] = i;
          queries.push({ ...t, refId, datasource: { uid: ds.uid, type: ds.type }, ...(ds.id ? { datasourceId: ds.id } : {}), intervalMs: 60000, maxDataPoints: 100 });
        }
      }
      const time = dash.time || {};
      const r = await gf(c, 'POST', '/api/ds/query', { queries, from: String(time.from || 'now-15m'), to: 'now' });
      // último valor de cada painel
      const ultimo = {};
      for (const [refId, x] of Object.entries(r.results || {})) {
        const i = dono[refId]; if (i === undefined) continue;
        for (const f of x.frames || []) {
          const campos = (f.schema && f.schema.fields) || [], vals = (f.data && f.data.values) || [];
          const ti = campos.findIndex(fl => fl.type === 'time'), vi = campos.findIndex(fl => fl.type === 'number');
          if (vi < 0) continue;
          const v = vals[vi] || [];
          for (let k = v.length - 1; k >= 0; k--) if (v[k] !== null && v[k] !== undefined) {
            const em = ti >= 0 && vals[ti] ? vals[ti][k] : null;
            if (!ultimo[i] || (em && (!ultimo[i].em || em > ultimo[i].em))) ultimo[i] = { v: +v[k], em };
            break;
          }
        }
      }
      cache.paineis = ps.map((p, i) => {
        const df = (p.fieldConfig && p.fieldConfig.defaults) || {}, u = ultimo[i];
        const st = classificar(u ? u.v : null, df);
        return { id: p.id, titulo: String(p.title || '').trim(), st, v: u ? Math.round(u.v * 100) / 100 : null, em: u && u.em ? new Date(u.em).toISOString() : null,
          unidade: df.unit || '', max: df.max ?? null, texto: u ? '' : String(df.noValue || '') };
      });
      cache.atualizado = new Date().toISOString(); cache.erro = null;
    } catch (e) {
      cache.erro = (e.name === 'TimeoutError' || e.cause) ? `não consegui falar com o Grafana em ${c.url} (${e.cause ? e.cause.code || e.cause.message : 'tempo esgotado'}).` : e.message;
    }
    await gravarCache();
    return cache;
  }

  // título do medidor → estação (nome, município, "Pico do Jaraguá - GAP" → Jaraguá, "Guarujá" → "Santos / Guarujá")
  async function cruzar() {
    const c = await lerConfig();
    const { rows } = await pool.query('SELECT id, data FROM estacoes');
    const est = rows.map(r => ({ id: r.id, k: nkey2(r.data.n), m: nkey2(r.data.mu), partes: String(r.data.n || '').split(/\s*[\/–-]\s*/).map(nkey2).filter(x => x.length >= 4) }));
    const apel = new Map(Object.entries(c.apelidos).map(([t, id]) => [nkey2(t), id]));
    const achar = titulo => {
      if (apel.has(nkey2(titulo))) return [apel.get(nkey2(titulo))];
      const cand = [titulo, ...String(titulo).split(/\s*[-–(|]\s*/)].map(nkey2).filter(Boolean);
      for (const k of cand) { const e = est.find(x => x.k === k); if (e) return [e.id]; }
      for (const k of cand) { const e = est.filter(x => x.m === k); if (e.length) return e.map(x => x.id); }
      for (const k of cand) { const e = est.find(x => x.partes.includes(k)); if (e) return [e.id]; }
      // nome da estação dentro do título ("PICO DO JARAGUÁ" → Jaraguá); o mais comprido ganha
      const t = nkey2(titulo); const e = est.filter(x => x.k.length >= 5 && t.includes(x.k)).sort((a, b) => b.k.length - a.k.length)[0];
      return e ? [e.id] : [];
    };
    const estacoes = {}, semEstacao = [];
    const peso = { ar: 1, atencao: 3, baixo: 4, semdados: 5, visita: 2, instalar: 0 };
    for (const p of cache.paineis || []) {
      const ids = achar(p.titulo);
      if (!ids.length) { semEstacao.push(p.titulo); continue; }
      for (const id of ids) {
        const old = estacoes[id];
        // mais de um medidor para a mesma estação: vale o que tem valor; entre dois com valor, o pior
        if (!old || (old.v === null && p.v !== null) || (old.v !== null && p.v !== null && peso[p.st] > peso[old.st])) estacoes[id] = { ...p, rotulo: ROTULO[p.st] };
      }
    }
    const resumo = {}; for (const e of Object.values(estacoes)) resumo[e.st] = (resumo[e.st] || 0) + 1;
    return { estacoes, semEstacao, resumo };
  }

  app.get('/api/telemetria', requireRole('viewer'), async (_req, res, next) => {
    try {
      const c = await lerConfig(); const x = await cruzar();
      res.json({ atualizado: cache.atualizado, erro: cache.erro, configurado: !!(cache.paineis && cache.paineis.length), ...x, rotulos: ROTULO,
        link: c.url && c.dashboard ? `${c.url}/d/${encodeURIComponent(c.dashboard)}?orgId=1&refresh=5m` : null });
    } catch (e) { next(e); }
  });
  app.get('/api/telemetria/config', requireRole('admin'), async (_req, res, next) => {
    try {
      const c = await lerConfig(); const x = await cruzar();
      res.json({ url: c.url, dashboard: c.dashboard, temToken: !!c.token, envFixo: c.envFixo, apelidos: c.apelidos,
        atualizado: cache.atualizado, erro: cache.erro, paineis: (cache.paineis || []).length, resumo: x.resumo, semEstacao: x.semEstacao });
    } catch (e) { next(e); }
  });
  app.put('/api/telemetria/config', requireRole('admin'), async (req, res, next) => {
    try {
      const b = req.body || {};
      const { rows } = await pool.query("SELECT valor FROM config WHERE chave='telemetria'");
      const old = rows.length ? rows[0].valor : {};
      const s = (v, m = 300) => String(v ?? '').trim().slice(0, m);
      const novo = { ...old,
        url: b.url !== undefined ? s(b.url) : old.url, dashboard: b.dashboard !== undefined ? s(b.dashboard, 80) : old.dashboard,
        token: b.token ? s(b.token, 400) : (b.limparToken ? '' : old.token),
        apelidos: b.apelidos && typeof b.apelidos === 'object' ? Object.fromEntries(Object.entries(b.apelidos).slice(0, 200).map(([k, v]) => [s(k, 120), s(v, 80)]).filter(([k, v]) => k && v)) : old.apelidos };
      const m = String(novo.url || '').match(/^(https?:\/\/[^/]+)(?:\/.*?)?\/d\/([^/?#]+)/i);
      if (m) { novo.url = m[1]; novo.dashboard = m[2]; }
      if (novo.url && !/^https?:\/\//i.test(novo.url)) return res.status(400).json({ error: 'O endereço do Grafana precisa começar com http:// ou https://' });
      await gravarConfig(novo, req.user.username);
      await audit('config', 'telemetria', 'telemetria (no ar)', null, `${novo.url || '-'} · painel ${novo.dashboard || '-'}`, 'Configuração alterada');
      await sincronizar();
      res.json({ ok: !cache.erro, erro: cache.erro });
    } catch (e) { next(e); }
  });
  app.post('/api/telemetria/sincronizar', requireRole('admin'), async (_req, res, next) => {
    try { await sincronizar(); res.json({ ok: !cache.erro, erro: cache.erro, paineis: (cache.paineis || []).length }); } catch (e) { next(e); }
  });

  return {
    async iniciar() {
      await lerCache().catch(() => {});
      sincronizar().catch(() => {});
      clearInterval(timer); timer = setInterval(() => sincronizar().catch(() => {}), INTERVALO_MS); timer.unref && timer.unref();
    },
  };
};
