# Casca nativa do app do aluno (Capacitor)

Fase 1: estrutura isolada, dependências vendoradas e esqueleto Android. **Nada
aqui altera o site publicado.**

## A regra que sustenta esta pasta

O `www/` é **gerado**, nunca editado. O script `scripts/montar-web.mjs` copia
`app.html`, os módulos do aluno e o CSS do repositório e faz as trocas que só
valem na casca nativa. Os arquivos publicados (`app.html`, `js/supabase.js`)
continuam byte a byte como estão na Vercel — o PWA segue no ar, e é o plano B.

Corolário: **nunca conserte nada dentro de `www/`.** Conserte no repositório ou
no script, e monte de novo.

## Por que um `package.json` separado

A raiz é um site estático sem nenhuma dependência, e o `npm test` de lá roda em
200ms por causa disso. O Capacitor traz ~200 MB de `node_modules`; misturar os
dois tornaria a suíte do projeto refém da casca.

## O que o script resolve

O app baixa três coisas da internet para abrir: `supabase-js` (esm.sh), `lucide`
(unpkg, em `@latest`) e a fonte Inter (Google Fonts). No navegador o service
worker disfarça. Dentro de um app instalado, sem rede, é a diferença entre
abrir e não abrir — e a Apple testa em rede ruim. As três entram no pacote, e o
script **falha** se sobrar qualquer URL externa de carregamento.

O endereço do Supabase continua, claro: ele é o backend, não uma dependência de
carregamento.

## Uso

```
cd nativo
npm install
npm run montar     # gera www/
npm run sync       # monta + copia para o Android
npm run abrir      # abre no Android Studio
```

## Pré-requisitos do Android (ainda não instalados nesta máquina)

- **JDK 17+** — hoje há Java 1.8, que o Gradle do Capacitor não aceita;
- **Android SDK** + `ANDROID_HOME` — vêm com o Android Studio.

Sem eles o `www/` monta e dá para abrir no navegador, mas não há como compilar
nem rodar em aparelho.

## Fora do escopo desta fase

Push nativo, deep links, exclusão de conta, OTA, iOS e publicação em loja.
