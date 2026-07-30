// Busca de alimentos: filtros por fonte (client-side, sobre o que o RPC já
// devolveu) e os serviços de favoritos / mais usados.

import { grupo, teste, igual, ok, contem } from './runner.mjs';
import { chaveDeFonte, filtrarPorFonte, FILTROS, ABAS } from '../js/dieta-busca.js';
import { listarMaisUsados, listarFavoritos, favoritar, desfavoritar, buscarFoods } from '../js/dieta.js';
import { tabela, rpc, limpar, chamadas, falhar } from './duble-supabase.mjs';

const TACO   = { id: 'a', nome: 'Arroz', fonte_dados: 'TACO', nutri_id: null };
const USDA   = { id: 'b', nome: 'Oat', fonte_dados: 'USDA', nutri_id: null };
const PROPRIO = { id: 'c', nome: 'Meu shake', fonte_dados: 'Proprio', nutri_id: 'nutri-teste' };
const OFF    = { id: 'd', nome: 'Barra X', fonte_dados: 'OpenFoodFacts', nutri_id: null };
// Caso real do banco: alimento próprio que o nutri importou da TACO e editou.
const TACO_DO_NUTRI = { id: 'e', nome: 'Arroz ajustado', fonte_dados: 'TACO', nutri_id: 'nutri-teste' };

grupo('dieta-busca · classificação por fonte', () => {
  teste('cada fonte do catálogo tem sua chave', () => {
    igual(chaveDeFonte(TACO), 'taco');
    igual(chaveDeFonte(USDA), 'usda');
    igual(chaveDeFonte(OFF), 'off');
    igual(chaveDeFonte(PROPRIO), 'proprios');
  });

  teste('ter nutri_id vence a procedência do dado', () => {
    igual(chaveDeFonte(TACO_DO_NUTRI), 'proprios',
      'o que o nutri cadastrou é dele, mesmo tendo vindo da TACO');
  });

  teste('alimento sem fonte não some nem inventa categoria', () => {
    igual(chaveDeFonte({}), 'outros');
    igual(chaveDeFonte(null), 'outros');
  });
});

grupo('dieta-busca · filtro', () => {
  const todos = [TACO, USDA, PROPRIO, OFF];

  teste('sem filtro, passa tudo', () => {
    igual(filtrarPorFonte(todos, new Set()).length, 4);
    igual(filtrarPorFonte(todos, null).length, 4);
  });

  teste('um filtro deixa só a fonte pedida', () => {
    igual(filtrarPorFonte(todos, new Set(['taco'])).map(f => f.id), ['a']);
  });

  teste('dois filtros somam (OU, não E)', () => {
    igual(filtrarPorFonte(todos, new Set(['taco', 'proprios'])).map(f => f.id), ['a', 'c']);
  });

  teste('filtro sem resultado devolve lista vazia, não a original', () => {
    igual(filtrarPorFonte(todos, new Set(['receitas'])), []);
  });

  teste('não altera a lista recebida', () => {
    const original = [...todos];
    filtrarPorFonte(todos, new Set(['taco']));
    igual(todos, original);
  });

  teste('lista vazia ou nula não quebra', () => {
    igual(filtrarPorFonte([], new Set(['taco'])), []);
    igual(filtrarPorFonte(null, new Set(['taco'])), []);
  });

  teste('aceita array no lugar de Set', () => {
    igual(filtrarPorFonte(todos, ['usda']).map(f => f.id), ['b']);
  });
});

grupo('dieta-busca · abas e filtros disponíveis', () => {
  teste('as quatro abas do briefing existem', () => {
    igual(ABAS.map(([k]) => k), ['alimentos', 'favoritos', 'recentes', 'maisusados']);
  });

  teste('Receitas aparece desligada, com o motivo', () => {
    const receitas = FILTROS.find(f => f.chave === 'receitas');
    ok(receitas, 'o filtro Receitas tem que existir');
    ok(receitas.indisponivel, 'e tem que dizer por que não funciona ainda');
    contem(receitas.indisponivel, 'Etapa 5');
  });
});

grupo('dieta (serviço) · mais usados', () => {
  teste('ranqueia por número de vezes prescrito', async () => {
    limpar();
    tabela('refeicao_itens', [
      { food_id: 'b' }, { food_id: 'a' }, { food_id: 'b' },
      { food_id: 'c' }, { food_id: 'b' }, { food_id: 'a' },
    ]);
    tabela('foods', [TACO, USDA, PROPRIO]);
    const r = await listarMaisUsados(10);
    igual(r.map(f => f.id), ['b', 'a', 'c'], 'b(3) > a(2) > c(1)');
  });

  teste('respeita o limite pedido', async () => {
    limpar();
    tabela('refeicao_itens', [{ food_id: 'a' }, { food_id: 'b' }, { food_id: 'c' }]);
    tabela('foods', [TACO, USDA, PROPRIO]);
    igual((await listarMaisUsados(2)).length, 2);
  });

  teste('sem itens prescritos, devolve vazio sem ir buscar foods', async () => {
    limpar();
    tabela('refeicao_itens', []);
    igual(await listarMaisUsados(10), []);
    ok(!chamadas.some(c => c.tabela === 'foods'), 'não devia consultar foods à toa');
  });

  teste('ignora item sem food_id (linha antiga, ainda em alimentos)', async () => {
    limpar();
    tabela('refeicao_itens', [{ food_id: null }, { food_id: 'a' }]);
    tabela('foods', [TACO]);
    igual((await listarMaisUsados(10)).map(f => f.id), ['a']);
  });

  teste('food apagado do catálogo não vira buraco na lista', async () => {
    limpar();
    tabela('refeicao_itens', [{ food_id: 'sumiu' }, { food_id: 'a' }]);
    tabela('foods', [TACO]);
    igual((await listarMaisUsados(10)).map(f => f.id), ['a']);
  });

  teste('erro do banco sobe para quem chamou', async () => {
    limpar();
    tabela('refeicao_itens', [{ food_id: 'a' }]);
    falhar('refeicao_itens', 'permission denied');
    let erro = null;
    try { await listarMaisUsados(10); } catch (e) { erro = e; }
    ok(erro, 'esperava que lançasse');
    contem(erro.message, 'permission denied');
  });
});

grupo('dieta (serviço) · favoritos', () => {
  teste('favoritar grava nutri_id e food_id', async () => {
    limpar();
    await favoritar('nutri-teste', 'a');
    const c = chamadas.find(x => x.tabela === 'favorite_foods');
    igual(c.operacao, 'upsert');
    igual(c.payload.nutri_id, 'nutri-teste');
    igual(c.payload.food_id, 'a');
  });

  teste('desfavoritar filtra pelos dois campos (nunca só por food_id)', async () => {
    limpar();
    await desfavoritar('nutri-teste', 'a');
    const c = chamadas.find(x => x.tabela === 'favorite_foods');
    igual(c.operacao, 'delete');
    igual(c.filtros.map(f => f.coluna).sort(), ['food_id', 'nutri_id']);
  });

  teste('lista de favoritos sai em ordem alfabética pt-BR', async () => {
    limpar();
    tabela('favorite_foods', [
      { food_id: 'z', foods: { id: 'z', nome: 'Ômega' } },
      { food_id: 'a', foods: { id: 'a', nome: 'Abacate' } },
      { food_id: 'o', foods: { id: 'o', nome: 'Ovo' } },
    ]);
    // Colação pt-BR compara a letra base primeiro: Ô e O empatam, então decide
    // a segunda letra (m < v). "Ômega" antes de "Ovo" está certo — ordenação
    // por código de caractere é que jogaria os acentuados para o fim da lista.
    igual((await listarFavoritos()).map(f => f.nome), ['Abacate', 'Ômega', 'Ovo']);
  });
});

grupo('dieta (serviço) · busca', () => {
  teste('usa o RPC foods_buscar, não um select montado na mão', async () => {
    limpar();
    rpc('foods_buscar', (p) => [{ id: 'a', nome: `achou ${p.p_termo}` }]);
    const r = await buscarFoods('arroz', 5);
    igual(r[0].nome, 'achou arroz');
    const c = chamadas.find(x => x.operacao === 'rpc');
    igual(c.nome, 'foods_buscar');
    igual(c.payload.p_limit, 5);
  });

  teste('termo vazio não vai ao banco', async () => {
    limpar();
    igual(await buscarFoods('   '), []);
    ok(!chamadas.length, 'não devia chamar nada');
  });
});
