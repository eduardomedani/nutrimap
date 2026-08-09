// ═══════════════════════════════════════════════════════════
// DUBLÊ DO SUPABASE
// ═══════════════════════════════════════════════════════════
// Substitui js/supabase.js nos testes (a troca é feita em test/hook.mjs, no
// resolve do loader). Implementa só o que os serviços do projeto usam de
// verdade: o encadeamento from().select().eq()... e o rpc().
//
// A cadeia é "thenable": qualquer ponto dela pode ser aguardado e devolve
// { data, error }, igual ao cliente real. Os filtros são registrados, não
// executados — quem decide o retorno é a tabela cadastrada em `tabela()` ou o
// atendimento programado em `responder()`.
//
// NÃO tenta imitar o Postgres. Testar SQL com um dublê seria testar o dublê.

const _tabelas = new Map();     // nome -> array de linhas
const _rpcs = new Map();        // nome -> (params) => data
const _erros = new Map();       // nome da tabela -> erro a devolver
export const chamadas = [];     // histórico, para asserção de "o que foi chamado"

// Storage: só o que os serviços usam — upload, remove e createSignedUrl. O
// mapa é o "bucket": guarda os caminhos que subiram, para o teste poder
// afirmar que a compensação apagou o arquivo depois de o banco falhar.
const _objetos = new Map();     // `${bucket}/${caminho}` -> { contentType }
const _errosStorage = new Map();// 'upload' | 'remove' -> mensagem

/** Popula uma tabela. `tabela('foods', [...])` */
export function tabela(nome, linhas) { _tabelas.set(nome, linhas || []); }

/** Programa um rpc. `rpc('foods_buscar', p => [...])` */
export function rpc(nome, fn) { _rpcs.set(nome, fn); }

/** Faz a próxima operação nesta tabela falhar (testa o caminho de erro). */
export function falhar(nomeTabela, mensagem) { _erros.set(nomeTabela, { message: mensagem }); }

/** Faz a próxima operação do Storage falhar. `falharStorage('remove', '...')` */
export function falharStorage(operacao, mensagem) { _errosStorage.set(operacao, { message: mensagem }); }

/** Os caminhos que estão no bucket agora — é o que prova ausência de órfão. */
export function objetos(bucket = null) {
  const todos = [..._objetos.keys()];
  if (!bucket) return todos;
  const prefixo = `${bucket}/`;
  return todos.filter(k => k.startsWith(prefixo)).map(k => k.slice(prefixo.length));
}

export function limpar() {
  _tabelas.clear(); _rpcs.clear(); _erros.clear(); chamadas.length = 0;
  _objetos.clear(); _errosStorage.clear();
}

function cadeia(tabelaNome, operacao, payload) {
  const registro = { tabela: tabelaNome, operacao, payload, filtros: [], colunas: null, limite: null, ordem: null };
  chamadas.push(registro);

  const resolver = () => {
    const erro = _erros.get(tabelaNome);
    if (erro) { _erros.delete(tabelaNome); return { data: null, error: erro }; }
    if (operacao !== 'select') return { data: payload ?? null, error: null };

    let linhas = [..._tabelas.get(tabelaNome) || []];
    // `in` e `eq` são os únicos filtros que o dublê aplica de verdade: são os
    // que mudam o RESULTADO esperado nos testes (ranking, favoritos).
    for (const f of registro.filtros) {
      if (f.tipo === 'in')  linhas = linhas.filter(l => f.valores.includes(l[f.coluna]));
      if (f.tipo === 'eq')  linhas = linhas.filter(l => String(l[f.coluna]) === String(f.valor));
      if (f.tipo === 'not-null') linhas = linhas.filter(l => l[f.coluna] != null);
      if (f.tipo === 'null') linhas = linhas.filter(l => l[f.coluna] == null);
    }
    if (registro.limite != null) linhas = linhas.slice(0, registro.limite);
    return { data: linhas, error: null };
  };

  const api = {
    select(colunas) { registro.colunas = colunas; return api; },
    eq(coluna, valor) { registro.filtros.push({ tipo: 'eq', coluna, valor }); return api; },
    in(coluna, valores) { registro.filtros.push({ tipo: 'in', coluna, valores }); return api; },
    not(coluna, op, valor) {
      if (op === 'is' && valor === null) registro.filtros.push({ tipo: 'not-null', coluna });
      return api;
    },
    is(coluna, valor) {
      if (valor === null) registro.filtros.push({ tipo: 'null', coluna });
      return api;
    },
    order(coluna, opts) { registro.ordem = { coluna, ...opts }; return api; },
    limit(n) { registro.limite = n; return api; },
    single() { return finalizar(true); },
    maybeSingle() { return finalizar(true); },
    then(res, rej) { return finalizar(false).then(res, rej); },
  };

  function finalizar(umSo) {
    const r = resolver();
    const data = umSo && Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return Promise.resolve({ ...r, data });
  }
  return api;
}

export const sb = {
  from(nome) {
    return {
      select: (colunas) => cadeia(nome, 'select').select(colunas),
      insert: (linhas) => cadeia(nome, 'insert', linhas),
      update: (linhas) => cadeia(nome, 'update', linhas),
      upsert: (linhas) => cadeia(nome, 'upsert', linhas),
      delete: () => cadeia(nome, 'delete', true),
    };
  },
  storage: {
    from(bucket) {
      return {
        async upload(caminho, conteudo, opcoes = {}) {
          chamadas.push({ tabela: null, operacao: 'upload', bucket, payload: caminho });
          const erro = _errosStorage.get('upload');
          if (erro) { _errosStorage.delete('upload'); return { data: null, error: erro }; }
          const chave = `${bucket}/${caminho}`;
          // upsert: false é o padrão do serviço — colisão tem que doer.
          if (_objetos.has(chave) && !opcoes.upsert) {
            return { data: null, error: { message: 'duplicate key value' } };
          }
          _objetos.set(chave, { contentType: opcoes.contentType || null });
          return { data: { path: caminho }, error: null };
        },
        async remove(caminhos) {
          chamadas.push({ tabela: null, operacao: 'remove', bucket, payload: caminhos });
          const erro = _errosStorage.get('remove');
          if (erro) { _errosStorage.delete('remove'); return { data: null, error: erro }; }
          for (const c of caminhos) _objetos.delete(`${bucket}/${c}`);
          return { data: [], error: null };
        },
        async createSignedUrl(caminho, segundos) {
          chamadas.push({ tabela: null, operacao: 'signed', bucket, payload: caminho, segundos });
          const erro = _errosStorage.get('signed');
          if (erro) { _errosStorage.delete('signed'); return { data: null, error: erro }; }
          return { data: { signedUrl: `https://exemplo.invalid/${caminho}?exp=${segundos}` }, error: null };
        },
      };
    },
  },
  rpc(nome, params) {
    chamadas.push({ tabela: null, operacao: 'rpc', nome, payload: params });
    const fn = _rpcs.get(nome);
    if (!fn) return Promise.resolve({ data: [], error: null });
    try { return Promise.resolve({ data: fn(params), error: null }); }
    catch (e) { return Promise.resolve({ data: null, error: { message: e.message } }); }
  },
  auth: {
    getUser: async () => ({ data: { user: { id: 'nutri-teste' } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: 'nutri-teste' } } }, error: null }),
  },
};

export const QUESTIONARIO_URL = 'http://localhost:3000/questionario.html';
