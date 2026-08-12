// Camada de acesso ao banco SQLite. Guarda cada visita como uma linha (para permitir
// filtrar por data/loja diretamente no banco) e catalogo/metas/gerentes como blobs JSON
// numa tabela chave-valor simples, já que são pequenos e não precisam de filtro por data.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'auditoria.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    loja TEXT,
    data TEXT,
    status TEXT,
    auditor TEXT,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_visits_data ON visits(data);
  CREATE INDEX IF NOT EXISTS idx_visits_loja ON visits(loja);

  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function getKv(key, fallback) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setKv(key, value) {
  db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}

function getState() {
  const rows = db.prepare('SELECT payload FROM visits ORDER BY data DESC, updated_at DESC').all();
  const visits = rows.map((r) => JSON.parse(r.payload));
  return {
    visits,
    catalogo: getKv('catalogo', []),
    metas: getKv('metas', {}),
    gerentes: getKv('gerentes', {})
  };
}

const upsertStmt = db.prepare(`
  INSERT INTO visits (id, loja, data, status, auditor, payload, updated_at)
  VALUES (@id, @loja, @data, @status, @auditor, @payload, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    loja = excluded.loja,
    data = excluded.data,
    status = excluded.status,
    auditor = excluded.auditor,
    payload = excluded.payload,
    updated_at = excluded.updated_at
`);

function upsertVisit(visit) {
  if (!visit || !visit.id) throw new Error('Visita sem id');
  upsertStmt.run({
    id: visit.id,
    loja: visit.loja || '',
    data: visit.data || '',
    status: visit.status || '',
    auditor: visit.auditor || '',
    payload: JSON.stringify(visit),
    updated_at: new Date().toISOString()
  });
}

function deleteVisit(id) {
  db.prepare('DELETE FROM visits WHERE id = ?').run(id);
}

const replaceAllTx = db.transaction((visits) => {
  db.prepare('DELETE FROM visits').run();
  visits.forEach(upsertVisit);
});

function replaceAllVisits(visits) {
  replaceAllTx(Array.isArray(visits) ? visits : []);
}

function setCatalogo(catalogo) {
  setKv('catalogo', Array.isArray(catalogo) ? catalogo : []);
}
function setMetas(metas) {
  setKv('metas', metas && typeof metas === 'object' ? metas : {});
}
function setGerentes(gerentes) {
  setKv('gerentes', gerentes && typeof gerentes === 'object' ? gerentes : {});
}

module.exports = {
  getState,
  upsertVisit,
  deleteVisit,
  replaceAllVisits,
  setCatalogo,
  setMetas,
  setGerentes
};
