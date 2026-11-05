// Rede TV Cultura SP · servidor do mapa e cadastro das estações
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const pg = require('pg');
const auth = require('./auth');

const { resolveDatabaseUrl, loadEnvFiles, sslOpt } = require('./db/connect');
loadEnvFiles(); // .env da pasta do sistema e /etc/rede-tv-cultura.env (PORT, ADMIN_TOKEN, DATABASE_URL...)
const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = require('./package.json').version;
const DATA_DIR = path.join(__dirname, 'data');

// O banco é descoberto na inicialização (veja db/connect.js); as rotas usam este objeto
let realPool = null;
const pool = {
  query: (...a) => realPool.query(...a),
  connect: () => realPool.connect(),
};

/* ---------- validação dos dados de uma estação ---------- */
const RECEPCAO = ['R', 'N', 'J', 'X', 'G', 'H', 'P', 'F'];
const MANUT = ['', 'full', 'half', 'line', 'cross'];
const LABELS = {
  n: 'nome', mu: 'município', a: 'área/equipe', r: 'recepção', pm: 'canal PM', m: 'canal/manutenção',
  ch: 'canal físico', vt: 'canal virtual', ob: 'observação', pop: 'população', pot: 'potência TX',
  en: 'energia', ag: 'água', ab: 'abrigo', cov: 'cobertura', pos: 'posição no mapa',
};
// nomes das áreas: lidos do banco (tabela areas) e guardados aqui para o texto do histórico
let AREA_NAME = {};
async function loadAreaNames() {
  const { rows } = await pool.query('SELECT id, nome, responsavel FROM areas');
  AREA_NAME = Object.fromEntries(rows.map(r => [r.id, `${r.nome} · ${r.responsavel}`]));
}

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const numOr = (v, d) => { const n = num(v); return n === null ? d : n; };

// Recebe o que veio da página e devolve só os campos conhecidos, no tipo certo
function cleanStation(b, prev = {}) {
  const d = {
    n: str(b.n, 120),
    mu: str(b.mu, 120),
    a: [1, 2, 3, 4, 5].includes(Number(b.a)) ? Number(b.a) : 1,
    r: RECEPCAO.includes(b.r) ? b.r : 'R',
    pm: b.pm ? 1 : 0,
    m: MANUT.includes(b.m) ? b.m : '',
    ch: str(b.ch, 20),
    vt: str(b.vt, 20),
    ob: str(b.ob, 300),
    pop: Math.max(0, Math.round(numOr(b.pop, 0))),
    pot: str(b.pot, 30),
    en: str(b.en, 60), ag: str(b.ag, 60), ab: str(b.ab, 60),
    cf: str(b.cf ?? prev.cf, 20), cv: str(b.cv ?? prev.cv, 20),
    x: numOr(b.x, prev.x ?? 4780), y: numOr(b.y, prev.y ?? 520),
    lat: numOr(b.lat, prev.lat ?? -23.55), lon: numOr(b.lon, prev.lon ?? -46.63),
    lx: num(b.lx), ly: num(b.ly),
    ll: Array.isArray(b.ll) ? b.ll.slice(0, 8).map(s => str(s, 80)) : null,
    cov: Array.isArray(b.cov)
      ? b.cov.slice(0, 300).map(c => [str(Array.isArray(c) ? c[0] : c, 120), Math.max(0, Math.round(numOr(Array.isArray(c) ? c[1] : 0, 0)))]).filter(c => c[0])
      : [],
  };
  if (d.lx === null || d.ly === null || !d.ll || !d.ll.length) { d.lx = null; d.ly = null; d.ll = null; }
  // mantém o desenho dentro da área do mapa
  d.x = Math.min(5250, Math.max(4300, d.x)); d.y = Math.min(850, Math.max(230, d.y));
  return d;
}
function stationProblem(d) {
  if (!d.n) return 'Preencha o nome da estação.';
  return null;
}
const show = (k, d) => {
  if (k === 'a') return AREA_NAME[d.a] || String(d.a);
  if (k === 'cov') return (d.cov || []).map(c => c[0]).join(', ');
  if (k === 'pos') return `${Math.round(d.x)}, ${Math.round(d.y)}`;
  if (k === 'pm') return d.pm ? 'sim' : 'não';
  return d[k] === null || d[k] === undefined ? '' : String(d[k]);
};
function diff(oldD, newD) {
  const out = [];
  for (const k of Object.keys(LABELS)) {
    const a = show(k, oldD), b = show(k, newD);
    if (a !== b) out.push([LABELS[k], a, b]);
  }
  return out;
}
const slug = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'estacao';

/* ---------- banco: tabelas e carga inicial ---------- */
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
    const { rows } = await client.query('SELECT count(*)::int AS n FROM estacoes');
    if (rows[0].n === 0) {
      const file = path.join(DATA_DIR, 'estacoes.json');
      const all = JSON.parse(fs.readFileSync(file, 'utf8'));
      await client.query('BEGIN');
      for (const [id, raw] of Object.entries(all)) {
        const d = cleanStation(raw);
        await client.query('INSERT INTO estacoes (id, data, updated_at, updated_by) VALUES ($1, $2, COALESCE($3::timestamptz, now()), NULL) ON CONFLICT (id) DO NOTHING',
          [id, d, raw.upd || null]);
      }
      await client.query("INSERT INTO audit_log (tbl,row_id,field,context,username) VALUES ('estacoes','-','carga inicial',$1,'servidor')",
        [`${Object.keys(all).length} estações de data/estacoes.json`]);
      await client.query('COMMIT');
      console.log(`Banco populado com ${Object.keys(all).length} estações.`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- aplicação ---------- */
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const { requireRole, bootstrap, audit } = auth.setup(app, pool);
const editor = requireRole('editor');

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, version: VERSION }); }
  catch { res.status(503).json({ ok: false }); }
});

// desenho do mapa (contorno, divisão regional, áreas, posição dos municípios)
app.get('/api/geometria', (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(DATA_DIR, 'geometria.json'));
});

const rowOut = r => ({ id: r.id, ...r.data, upd: r.updated_at, by: r.updated_by });

app.get('/api/estacoes', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM estacoes ORDER BY id');
    const v = await pool.query("SELECT coalesce(max(id),0)::int AS v FROM audit_log WHERE tbl IN ('estacoes','areas')");
    res.json({ versao: v.rows[0].v, estacoes: rows.map(rowOut) });
  } catch (e) { next(e); }
});

// número que muda a cada alteração: a página consulta a cada poucos segundos e recarrega se mudou
app.get('/api/estacoes/versao', async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT coalesce(max(id),0)::int AS v FROM audit_log WHERE tbl IN ('estacoes','areas')");
    res.json({ versao: rows[0].v });
  } catch (e) { next(e); }
});

app.post('/api/estacoes', editor, async (req, res, next) => {
  const d = cleanStation(req.body || {});
  const p = stationProblem(d); if (p) return res.status(400).json({ error: p });
  const id = `${slug(d.n)}-${Date.now().toString(36)}`;
  try {
    const { rows } = await pool.query('INSERT INTO estacoes (id,data,updated_by) VALUES ($1,$2,$3) RETURNING *', [id, d, req.user.username]);
    await audit('estacoes', id, 'cadastro', null, d.n, `${d.n} · ${AREA_NAME[d.a]}`);
    res.status(201).json(rowOut(rows[0]));
  } catch (e) { next(e); }
});

app.put('/api/estacoes/:id', editor, async (req, res, next) => {
  const id = String(req.params.id);
  try {
    const cur = await pool.query('SELECT * FROM estacoes WHERE id=$1', [id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Essa estação não existe mais. Outra pessoa pode ter excluído.' });
    const old = cur.rows[0].data;
    const d = cleanStation(req.body || {}, old);
    const p = stationProblem(d); if (p) return res.status(400).json({ error: p });
    // se o nome, o canal ou o VT mudaram, o rótulo original do DWG deixa de valer
    if (old.ll && (d.n !== old.n || d.ch !== old.ch || d.vt !== old.vt || d.x !== old.x || d.y !== old.y)) { d.lx = null; d.ly = null; d.ll = null; }
    const changes = diff(old, d);
    if (!changes.length) return res.json(rowOut(cur.rows[0]));
    const { rows } = await pool.query('UPDATE estacoes SET data=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [d, req.user.username, id]);
    for (const [f, a, b] of changes) await audit('estacoes', id, f, a.slice(0, 2000), b.slice(0, 2000), d.n);
    res.json(rowOut(rows[0]));
  } catch (e) { next(e); }
});

app.delete('/api/estacoes/:id', editor, async (req, res, next) => {
  const id = String(req.params.id);
  try {
    const { rows } = await pool.query('DELETE FROM estacoes WHERE id=$1 RETURNING *', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Essa estação já tinha sido excluída.' });
    // guarda o registro completo no histórico, para poder recuperar
    await audit('estacoes', id, 'exclusão', JSON.stringify(rows[0].data), null, rows[0].data.n);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Restaura uma estação excluída a partir do histórico (admin)
app.post('/api/estacoes/:id/restaurar', requireRole('admin'), async (req, res, next) => {
  const id = String(req.params.id);
  try {
    const { rows } = await pool.query("SELECT old_value FROM audit_log WHERE tbl='estacoes' AND row_id=$1 AND field='exclusão' ORDER BY id DESC LIMIT 1", [id]);
    if (!rows.length) return res.status(404).json({ error: 'Não há exclusão registrada para essa estação.' });
    const d = cleanStation(JSON.parse(rows[0].old_value));
    await pool.query('INSERT INTO estacoes (id,data,updated_by) VALUES ($1,$2,$3)', [id, d, req.user.username]);
    await audit('estacoes', id, 'restauração', null, d.n, d.n);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Essa estação já existe.' });
    next(e);
  }
});

/* ---------- áreas (nome e responsável) ---------- */
app.get('/api/areas', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, nome, responsavel FROM areas ORDER BY ordem, id');
    res.json(rows);
  } catch (e) { next(e); }
});

app.put('/api/areas/:id', editor, async (req, res, next) => {
  const id = Number(req.params.id);
  const nome = str((req.body || {}).nome, 60), responsavel = str((req.body || {}).responsavel, 80);
  if (!nome || !responsavel) return res.status(400).json({ error: 'Preencha o nome da área e o responsável.' });
  try {
    const cur = await pool.query('SELECT * FROM areas WHERE id=$1', [id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Área não encontrada.' });
    const old = cur.rows[0];
    await pool.query('UPDATE areas SET nome=$1, responsavel=$2 WHERE id=$3', [nome, responsavel, id]);
    if (old.nome !== nome) await audit('areas', String(id), 'nome da área', old.nome, nome, `${nome} · ${responsavel}`);
    if (old.responsavel !== responsavel) await audit('areas', String(id), 'responsável', old.responsavel, responsavel, `${nome} · ${responsavel}`);
    await loadAreaNames();
    res.json({ id, nome, responsavel });
  } catch (e) { next(e); }
});

app.get('/api/historico', async (req, res, next) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 300));
  const params = [limit];
  let where = '';
  if (req.query.estacao) { where = "WHERE tbl='estacoes' AND row_id=$2"; params.push(String(req.query.estacao)); }
  else if (req.user.role !== 'admin') where = "WHERE tbl IN ('estacoes','areas')";
  try {
    const { rows } = await pool.query(`SELECT id, at, tbl, row_id, field, old_value, new_value, context, username FROM audit_log ${where} ORDER BY id DESC LIMIT $1`, params);
    res.json(rows.map(r => ({ ...r, old_value: r.field === 'exclusão' ? null : r.old_value, restoravel: r.field === 'exclusão' })));
  } catch (e) { next(e); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endereço não encontrado.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro no servidor. Tente de novo.' });
});

resolveDatabaseUrl()
  .then(({ url, how }) => {
    realPool = new pg.Pool({ connectionString: url, ssl: sslOpt() });
    console.log(`Banco de dados: ${how}`);
  })
  .then(migrate)
  .then(loadAreaNames)
  .then(bootstrap)
  .then(() => app.listen(PORT, HOST, () => console.log(`Rede TV Cultura SP ${VERSION} rodando em ${HOST}:${PORT}`)))
  .catch(e => { console.error(e.friendly ? e.message : 'Falha ao preparar o banco: ' + (e.stack || e)); process.exit(1); });

module.exports = { cleanStation, diff };
