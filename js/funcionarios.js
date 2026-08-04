// ═══════════════════════════════════════════════════════════
// FUNCIONÁRIOS — camada de dados do cadastro da equipe
// ═══════════════════════════════════════════════════════════
// Primeira peça do módulo Financeiro. Aqui é só CADASTRO: quem é a pessoa,
// como falar com ela, onde trabalha. Dinheiro (salário, comissão, Pix) vai
// morar em tabela própria apontando para funcionarios(id) — separar os dois
// evita que um reajuste reescreva a linha que guarda o CPF.
//
// Convenções do projeto: RLS filtra por nutri_id; o insert grava nutri_id
// explicitamente (mesmo padrão de treinos.criarExercicio).
//
// CPF, telefone e CEP são guardados SÓ COM DÍGITOS. Máscara é assunto de tela:
// no banco, o que vale é a chave — é por ela que o índice único de CPF pega
// a mesma pessoa cadastrada duas vezes.

import { sb } from './supabase.js';

/** Sugestões do datalist. Texto livre continua permitido. */
export const CARGOS = [
  'Instrutor', 'Administrador', 'Gerente', 'Recepção', 'Personal trainer',
  'Nutricionista', 'Fisioterapeuta', 'Estagiário', 'Limpeza', 'Manutenção',
];

export const CONSELHOS = ['CREF', 'CRN', 'CRM', 'CREFITO', 'CRP', 'COREN'];

export const SEXOS = {
  feminino:  'Feminino',
  masculino: 'Masculino',
  outro:     'Outro',
};

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
  'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC',
  'SE', 'SP', 'TO',
];

// ── Leitura ────────────────────────────────────────────────

/**
 * Lista a equipe em ordem alfabética, filtrando no banco (não no navegador).
 *
 *   { termo, incluirInativos, limite, offset }
 *     · termo           — nome, cargo ou CPF (dígitos do termo casam com o CPF)
 *     · incluirInativos — por padrão o desligado não aparece
 */
export async function listarFuncionarios({ termo = '', incluirInativos = false, limite = 60, offset = 0 } = {}) {
  let q = sb.from('funcionarios').select('*').order('nome', { ascending: true });

  if (!incluirInativos) q = q.eq('ativo', true);

  const t = String(termo || '').trim();
  if (t) {
    // Vírgula e parênteses quebram a sintaxe do .or() do PostgREST — saem antes.
    const alvo = t.replace(/[,()*.]/g, ' ').trim();
    const like = `%${alvo}%`;
    const filtros = [`nome.ilike.${like}`, `cargo.ilike.${like}`, `email.ilike.${like}`];
    const digitos = soDigitos(t);
    if (digitos) filtros.push(`cpf.ilike.%${digitos}%`, `telefone.ilike.%${digitos}%`);
    q = q.or(filtros.join(','));
  }

  q = q.range(offset, offset + limite - 1);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function buscarFuncionario(id) {
  const { data, error } = await sb.from('funcionarios').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

// ── Escrita ────────────────────────────────────────────────

export async function criarFuncionario(nutriId, dados) {
  const { data, error } = await sb
    .from('funcionarios')
    .insert({ ...normalizarFuncionario(dados), nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarFuncionario(id, dados) {
  const { data, error } = await sb
    .from('funcionarios')
    .update({ ...normalizarFuncionario(dados), atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/**
 * Desligamento suave. Preferir a exclusão: quando a folha existir, apagar um
 * funcionário apagaria junto o histórico de quanto ele custou.
 */
export async function definirAtivo(id, ativo) {
  return atualizarFuncionario(id, { ativo: !!ativo });
}

export async function excluirFuncionario(id) {
  const { error } = await sb.from('funcionarios').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ───────────────────────────────────────────────────────────
// HELPERS PUROS — sem DOM e sem rede, para o teste alcançar
// ───────────────────────────────────────────────────────────

export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** 12345678901 → 123.456.789-01. Devolve o que veio se não tiver 11 dígitos. */
export function formatarCPF(v) {
  const d = soDigitos(v);
  if (d.length !== 11) return String(v ?? '');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Dígitos verificadores do CPF. Vale a pena checar de verdade: um dígito
 * trocado no cadastro só aparece meses depois, num holerite ou num informe de
 * rendimentos, e aí a correção já passou por três lugares.
 */
export function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;          // 000.000.000-00 e afins passam na conta

  const dv = (ate) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** (27) 99999-8888 para celular; (27) 3333-4444 para fixo. */
export function formatarTelefone(v) {
  const d = soDigitos(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? '');
}

export function formatarCEP(v) {
  const d = soDigitos(v);
  if (d.length !== 8) return String(v ?? '');
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Uma linha de endereço legível a partir das colunas soltas. */
export function enderecoResumido(f) {
  if (!f) return '';
  const rua = [f.logradouro, f.numero].filter(Boolean).join(', ');
  const local = [f.bairro, f.cidade, f.uf].filter(Boolean).join(' · ');
  return [rua, local, f.cep ? `CEP ${formatarCEP(f.cep)}` : ''].filter(Boolean).join(' — ');
}

/**
 * Formulário → payload do banco. Tira máscara do que é chave, normaliza e-mail
 * e transforma campo vazio em NULL — string vazia num campo único seria um
 * valor como outro qualquer, e dois "sem CPF" colidiriam entre si.
 */
export function normalizarFuncionario(form = {}) {
  const out = {};
  for (const [k, bruto] of Object.entries(form)) {
    if (bruto === undefined) continue;

    let v = bruto;
    if (typeof v === 'string') {
      v = v.trim();
      if (k === 'cpf' || k === 'telefone' || k === 'cep') v = soDigitos(v);
      else if (k === 'email') v = v.toLowerCase();
      else if (k === 'uf') v = v.toUpperCase();
      if (v === '') v = null;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Validação de negócio antes de bater no banco. Devolve lista de mensagens —
 * vazia quer dizer que pode salvar.
 */
export function validarFuncionario(form = {}) {
  const erros = [];
  const f = normalizarFuncionario(form);

  if (!f.nome) erros.push('Informe o nome do funcionário.');
  if (f.cpf && !cpfValido(f.cpf)) erros.push('CPF inválido — confira os números.');
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) erros.push('E-mail inválido.');
  if (f.telefone && f.telefone.length !== 10 && f.telefone.length !== 11) {
    erros.push('Telefone deve ter DDD + 8 ou 9 dígitos.');
  }
  if (f.cep && f.cep.length !== 8) erros.push('CEP deve ter 8 dígitos.');
  if (f.valor_hora != null && !(Number(f.valor_hora) >= 0)) erros.push('Valor da hora inválido.');
  if (f.salario_fixo != null && !(Number(f.salario_fixo) >= 0)) erros.push('Salário fixo inválido.');
  if (f.data_nascimento && new Date(`${f.data_nascimento}T12:00:00`) > new Date()) {
    erros.push('Data de nascimento no futuro.');
  }
  return erros;
}

/** Mensagem de erro do banco traduzida para o que o usuário pode fazer. */
export function traduzirErroFuncionario(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('uniq_funcionarios_cpf') || (m.includes('duplicate') && m.includes('cpf'))) {
    return 'Já existe um funcionário cadastrado com este CPF.';
  }
  if (m.includes('funcionarios_cpf_check')) return 'CPF precisa ter 11 dígitos.';
  if (m.includes('funcionarios_nome_check')) return 'O nome não pode ficar em branco.';
  if (m.includes('relation') && m.includes('funcionarios')) {
    return 'A tabela de funcionários ainda não existe no banco — rode db/funcionarios_schema.sql.';
  }
  return msg || 'Algo deu errado.';
}
