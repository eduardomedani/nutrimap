// A escolha da animação, a assinatura em lote e a renovação da URL expirada.
//
// O que estes testes protegem, em uma frase: o aluno vê a demonstração certa,
// o app não pede uma URL por vídeo, e um caminho que não veio do banco nunca
// é assinado.

import { grupo, teste, igual, ok } from './runner.mjs';
import { chamadas, limpar, falharStorage } from './duble-supabase.mjs';
import {
  normalizarSexo, escolherMidia, assinarDoTreino, renovar, limpar as limparMidias,
  BUCKET, VALIDADE_S, _caminhoDe,
} from '../js/exercicio-midia.js';

const zerar = () => { limpar(); limparMidias(); };
const doStorage = (op) => chamadas.filter(c => c.operacao === op);

// ── fábricas ────────────────────────────────────────────────────────────────
const m = (id, genero, caminho) => ({ id, genero, caminho, bucket: BUCKET });
const ex = (...linhas) => ({ nome: 'x', midias: linhas });
const linha = (midia, papel = 'principal', ordem = 0) => ({ papel, ordem, midia });
const item = (exercicio) => ({ exercicio });

// ═══════════════════════════════════════════════════════════════════════════

grupo('exercicio-midia · normalizarSexo', () => {
  teste('reconhece as duas grafias, e o desconhecido é nulo', () => {
    igual(normalizarSexo('Masculino'), 'M');
    igual(normalizarSexo('feminino'), 'F');
    igual(normalizarSexo('F'), 'F');
    igual(normalizarSexo(''), null);
    igual(normalizarSexo(null), null);
    igual(normalizarSexo('outro'), null);
  });
});

grupo('exercicio-midia · escolha do gênero', () => {
  const masc = m('a', 'masculino', 'a.mp4');
  const fem  = m('b', 'feminino', 'b.mp4');

  teste('aluna prefere a feminina', () => {
    igual(escolherMidia(ex(linha(masc), linha(fem, 'equivalente', 1)), 'F').id, 'b');
  });

  teste('aluno prefere a masculina', () => {
    igual(escolherMidia(ex(linha(fem), linha(masc, 'equivalente', 1)), 'M').id, 'a');
  });

  teste('sem sexo informado, prefere a masculina', () => {
    igual(escolherMidia(ex(linha(fem), linha(masc, 'equivalente', 1)), null).id, 'a');
  });

  teste('sem a do gênero preferido, mostra a principal — nunca esconde', () => {
    // Dos 49 exercícios com animação, 30 têm um gênero só. Devolver nulo aqui
    // deixaria a maioria do acervo sem demonstração na tela.
    igual(escolherMidia(ex(linha(fem)), 'M').id, 'b');
    igual(escolherMidia(ex(linha(masc)), 'F').id, 'a');
  });

  teste('sem preferido e sem principal, cai na primeira por ordem', () => {
    const duas = ex(linha(m('z', 'neutro', 'z.mp4'), 'equivalente', 2),
                    linha(m('y', 'neutro', 'y.mp4'), 'equivalente', 1));
    igual(escolherMidia(duas, 'F').id, 'y');
  });

  teste('exercício sem mídia devolve nulo', () => {
    igual(escolherMidia(ex(), 'M'), null);
    igual(escolherMidia({ nome: 'x' }, 'M'), null);
    igual(escolherMidia(null, 'M'), null);
  });

  teste('linha sem caminho é ignorada', () => {
    igual(escolherMidia(ex(linha({ id: 'q', genero: 'masculino' })), 'M'), null);
  });
});

grupo('exercicio-midia · assinatura em lote', () => {
  teste('um treino inteiro faz UMA chamada ao Storage', async () => {
    zerar();
    const itens = Array.from({ length: 12 }, (_, i) =>
      item(ex(linha(m(`id${i}`, 'masculino', `f${i}.mp4`)))));
    const urls = await assinarDoTreino(itens, 'M');
    igual(doStorage('signed-lote').length, 1, 'uma chamada só');
    igual(doStorage('signed-lote')[0].payload.length, 12);
    igual(urls.size, 12);
    ok(urls.get('id3').includes('f3.mp4'), 'a URL é a do arquivo certo');
  });

  teste('mídia compartilhada por dois exercícios é assinada uma vez', async () => {
    zerar();
    const mesma = m('comum', 'masculino', 'c.mp4');
    const urls = await assinarDoTreino([item(ex(linha(mesma))), item(ex(linha(mesma)))], 'M');
    igual(doStorage('signed-lote')[0].payload.length, 1, 'deduplicado');
    igual(urls.size, 1);
  });

  teste('assina SÓ a escolhida, não as duas do par M/F', async () => {
    zerar();
    const par = ex(linha(m('am', 'masculino', 'am.mp4')),
                   linha(m('af', 'feminino', 'af.mp4'), 'equivalente', 1));
    await assinarDoTreino([item(par)], 'F');
    const pedidos = doStorage('signed-lote')[0].payload;
    igual(pedidos.length, 1, 'uma, não duas');
    igual(pedidos[0], 'af.mp4');
  });

  teste('bucket e validade de uma hora', async () => {
    zerar();
    await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    igual(doStorage('signed-lote')[0].segundos, VALIDADE_S);
    igual(VALIDADE_S, 3600);
    igual(doStorage('signed-lote')[0].bucket, BUCKET);
  });

  teste('treino só com link externo não chama o Storage', async () => {
    zerar();
    const urls = await assinarDoTreino(
      [item({ nome: 'só link', video_url: 'https://youtube.com/watch?v=x' })], 'M');
    igual(doStorage('signed-lote').length, 0, 'nenhuma chamada');
    igual(urls.size, 0);
  });

  teste('erro do Storage não derruba a tela — devolve mapa vazio', async () => {
    zerar();
    falharStorage('signed-lote', 'indisponível');
    const urls = await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    igual(urls.size, 0);
  });

  teste('caminho que falhou fica de fora, os outros entram', async () => {
    zerar();
    falharStorage('signed:b.mp4', 'esse não');
    const urls = await assinarDoTreino([
      item(ex(linha(m('a', 'masculino', 'a.mp4')))),
      item(ex(linha(m('b', 'masculino', 'b.mp4')))),
    ], 'M');
    igual(urls.size, 1);
    ok(urls.has('a') && !urls.has('b'), 'só a que deu certo');
  });

  teste('lista vazia não chama nada', async () => {
    zerar();
    igual((await assinarDoTreino([], 'M')).size, 0);
    igual((await assinarDoTreino(null, 'M')).size, 0);
    igual(doStorage('signed-lote').length, 0);
  });
});

grupo('exercicio-midia · renovação da URL expirada', () => {
  teste('renova pelo id, e o caminho vem do Map interno', async () => {
    zerar();
    await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    igual(_caminhoDe('a'), 'a.mp4');
    ok((await renovar('a')).includes('a.mp4'));
    igual(doStorage('signed')[0].segundos, VALIDADE_S);
  });

  teste('id desconhecido NÃO é assinado', async () => {
    zerar();
    igual(await renovar('nunca-visto'), null);
    igual(doStorage('signed').length, 0, 'nem chegou a pedir');
  });

  teste('caminho arbitrário não vira id — a tranca é o Map', async () => {
    zerar();
    await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    igual(await renovar('../outro-bucket/segredo.mp4'), null);
    igual(await renovar('a.mp4'), null, 'nem o próprio caminho serve como id');
    igual(doStorage('signed').length, 0);
  });

  teste('duas ocorrências da mesma mídia fazem UM pedido', async () => {
    zerar();
    await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    const [u1, u2] = await Promise.all([renovar('a'), renovar('a')]);
    igual(doStorage('signed').length, 1, 'um pedido para as duas');
    igual(u1, u2);
  });

  teste('o cache é de voo, não de resultado', async () => {
    zerar();
    await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    await renovar('a');
    await renovar('a');
    igual(doStorage('signed').length, 2, 'terminado um, o próximo pede de novo');
  });

  teste('erro na renovação devolve nulo, sem estourar', async () => {
    zerar();
    await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    falharStorage('signed', 'expirou de novo');
    igual(await renovar('a'), null);
  });

  teste('limpar esquece os caminhos — sessão nova não herda a anterior', async () => {
    zerar();
    await assinarDoTreino([item(ex(linha(m('a', 'masculino', 'a.mp4'))))], 'M');
    limparMidias();
    igual(_caminhoDe('a'), null);
    igual(await renovar('a'), null);
  });
});
