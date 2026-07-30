// Loader do teste: resolve o que não existe fora do navegador.
//
//   . https://esm.sh/...   -> stub vazio (o cliente real nunca é criado)
//   . js/supabase.js       -> test/duble-supabase.mjs
//
// Trocar no RESOLVE, e não com monkey patch depois do import, é o que garante
// que os módulos do projeto sejam carregados exatamente como o navegador os
// carrega — mesma URL, mesma ordem, sem instrumentação no meio.

import { pathToFileURL } from 'node:url';
import { resolve as resolverCaminho, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DUBLE = pathToFileURL(resolverCaminho(AQUI, 'duble-supabase.mjs')).href;
const STUB_CDN = 'data:text/javascript,export const createClient = () => ({});export default {};';

export async function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith('https://')) return { url: STUB_CDN, shortCircuit: true };
  if (/(^|\/)supabase\.js$/.test(especificador)) return { url: DUBLE, shortCircuit: true };
  return proximo(especificador, contexto);
}
