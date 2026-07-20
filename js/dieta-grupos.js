// ═══════════════════════════════════════════════════════════
// DIETA — Grupos de equivalência e templates de refeição
// ═══════════════════════════════════════════════════════════
// Dado de curadoria, não de código. Os nomes são os do catálogo `foods`
// (TACO global + próprios), então o motor resolve food_id por nome exato.
//
// GRUPOS: alimentos intercambiáveis dentro de um papel. A ordem importa —
//   o gerador prefere o primeiro que passar nas restrições do paciente.
// TEMPLATES: esqueleto de refeições. Cada vaga aponta para um grupo e diz
//   se escala (o motor calcula a gramagem) ou é fixa.
//
// Derivado das estruturas de cardápio do Ciclo Magro (18 cardápios, 720
// substituições), consolidado de 19 grupos-âncora para 11 papéis.

export const GRUPOS = {
  'carbo-cafe': {
    nome: 'Carboidrato do café', papel: 'carbo',
    alimentos: [
      'Pão, trigo, forma, integral',
      'Aveia, flocos, crua',
      'Goma de tapioca hidratada',
      'Cuscuz, de milho, cozido com sal',
      'Torrada integral',
      'Banana, da terra, crua',
    ],
  },
  'carbo-principal': {
    nome: 'Carboidrato principal', papel: 'carbo',
    alimentos: [
      'Arroz, tipo 1, cozido',
      'Batata, doce, cozida',
      'Batata, inglesa, cozida',
      'Mandioca, cozida',
      'Macarrão, trigo, cozido',
      'Cará, cozido',
    ],
  },
  'leguminosa': {
    nome: 'Leguminosa', papel: 'carbo',
    alimentos: [
      'Feijão, carioca, cozido',
      'Lentilha, cozida',
      'Grão-de-bico, cozido',
      'Ervilha, em vagem',
    ],
  },
  'proteina-principal': {
    nome: 'Proteína principal', papel: 'proteina',
    alimentos: [
      'Frango, peito, sem pele, grelhado',
      'Frango, peito, sem pele, cozido',
      'Carne, bovina, patinho, sem gordura, grelhado',
      'Carne, bovina, maminha, grelhada',
      'Merluza, filé, assado',
      'Sardinha, assada',
      'Atum em água, drenado',
      'Porco, lombo, assado',
    ],
  },
  'proteina-cafe': {
    nome: 'Proteína do café', papel: 'proteina',
    alimentos: [
      'Ovo, de galinha, inteiro, cozido/10minutos',
      'Ovo, de galinha, clara, cozida/10minutos',
      'Queijo, minas, frescal',
      'Frango, peito, sem pele, cozido',
    ],
  },
  'proteina-extra': {
    nome: 'Proteína complementar', papel: 'proteina',
    alimentos: [
      'Whey protein concentrado',
      'Iogurte, natural',
      'Ovo, de galinha, clara, cozida/10minutos',
    ],
  },
  'laticinio': {
    nome: 'Laticínio', papel: 'proteina',
    alimentos: [
      'Queijo cottage',
      'Skyr natural',
      'Iogurte natural sem lactose',
      'Queijo, minas, frescal',
      'Creme de ricota light',
      'Requeijão light',
    ],
  },
  'fruta': {
    nome: 'Fruta', papel: 'carbo',
    alimentos: [
      'Mamão, Formosa, cru',
      'Banana, prata, crua',
      'Maçã, Fuji, com casca, crua',
      'Pêra, Williams, crua',
      'Morango, cru',
      'Melão, cru',
      'Kiwi, cru',
    ],
  },
  'gordura': {
    nome: 'Gordura', papel: 'gordura',
    alimentos: [
      'Azeite, de oliva, extra virgem',
      'Óleo de coco',
      'Manteiga, sem sal',
      'Castanha-do-Brasil, crua',
      'Castanha-de-caju, torrada, salgada',
      'Pasta de amendoim integral',
      'Abacate, cru',
    ],
  },
  'vegetal': {
    nome: 'Vegetais', papel: 'vegetal',
    alimentos: ['Vegetais variados (mix cru)', 'Vegetais refogados (mix)'],
  },
  'folhas': {
    nome: 'Folhas verdes', papel: 'vegetal',
    alimentos: ['Folhas verdes (mix)'],
  },
};

// ── Templates ────────────────────────────────────────────────
// base  = gramagem de partida (o motor ajusta para bater as metas)
// min/max = limites de bom senso por vaga, em gramas
// fixo  = gramagem travada; o motor não mexe
const VEGETAIS_FIXOS = [
  { grupo: 'vegetal', fixo: 200, medida: '01 prato de sobremesa' },
  { grupo: 'folhas',  fixo: 100, medida: 'à vontade' },
];

export const TEMPLATES = [
  {
    id: 'estrutura-a',
    nome: 'Estrutura A — arroz e feijão, proteína magra',
    descricao: '4 refeições. Café com pão, ovo e fruta; almoço e jantar com carboidrato + proteína + vegetais.',
    refeicoes: [
      { chave: 'cafe', nome: 'Café da manhã', horario: '07:00', slots: [
        { grupo: 'carbo-cafe',      base: 50,  min: 30,  max: 120 },
        { grupo: 'proteina-cafe',   base: 100, min: 50,  max: 180 },
        { grupo: 'fruta',           base: 130, min: 80,  max: 220 },
        { grupo: 'proteina-extra',  base: 20,  min: 15,  max: 40  },
        { grupo: 'laticinio',       base: 80,  min: 40,  max: 160 },
      ]},
      { chave: 'almoco', nome: 'Almoço', horario: '12:00', slots: [
        { grupo: 'carbo-principal', base: 80,  min: 40,  max: 180 },
        { grupo: 'leguminosa',      base: 86,  min: 50,  max: 150 },
        { grupo: 'proteina-principal', base: 130, min: 90, max: 240 },
        ...VEGETAIS_FIXOS,
        // escalável, não fixo: sem uma vaga de gordura que o motor possa mexer,
        // a meta de lipídio fica inalcançável e a proteína estoura compensando.
        { grupo: 'gordura',         base: 8,   min: 5,   max: 20  },
      ]},
      { chave: 'lanche', nome: 'Lanche', horario: '16:00', slots: [
        { grupo: 'carbo-cafe',      base: 35,  min: 20,  max: 70  },
        { grupo: 'laticinio',       base: 30,  min: 20,  max: 70  },
        { grupo: 'gordura',         base: 15,  min: 8,   max: 35  },
      ]},
      { chave: 'jantar', nome: 'Jantar', horario: '19:30', slots: [
        { grupo: 'carbo-principal', base: 180, min: 80,  max: 300 },
        { grupo: 'proteina-principal', base: 130, min: 90, max: 240 },
        ...VEGETAIS_FIXOS,
      ]},
    ],
  },
  {
    id: 'estrutura-b',
    nome: 'Estrutura B — aveia no café, peixe no jantar',
    descricao: 'Variação da A: café com aveia e banana, lanche com pasta de amendoim, jantar com batata-doce e peixe.',
    refeicoes: [
      { chave: 'cafe', nome: 'Café da manhã', horario: '07:00', slots: [
        { grupo: 'carbo-cafe',      base: 40,  min: 25,  max: 90  },
        { grupo: 'proteina-cafe',   base: 100, min: 50,  max: 180 },
        { grupo: 'fruta',           base: 100, min: 80,  max: 200 },
        { grupo: 'proteina-extra',  base: 20,  min: 15,  max: 40  },
      ]},
      { chave: 'almoco', nome: 'Almoço', horario: '12:00', slots: [
        { grupo: 'carbo-principal', base: 80,  min: 40,  max: 180 },
        { grupo: 'leguminosa',      base: 86,  min: 50,  max: 150 },
        { grupo: 'proteina-principal', base: 110, min: 90, max: 220 },
        ...VEGETAIS_FIXOS,
        { grupo: 'gordura',         fixo: 5,   medida: '01 colher de chá' },
      ]},
      { chave: 'lanche', nome: 'Lanche', horario: '16:00', slots: [
        { grupo: 'carbo-cafe',      base: 35,  min: 20,  max: 60  },
        { grupo: 'gordura',         base: 15,  min: 10,  max: 30  },
      ]},
      { chave: 'jantar', nome: 'Jantar', horario: '19:30', slots: [
        { grupo: 'carbo-principal', base: 120, min: 80,  max: 260 },
        { grupo: 'proteina-principal', base: 100, min: 90, max: 200 },
        ...VEGETAIS_FIXOS,
      ]},
    ],
  },
];

export function templatePorId(id) {
  return TEMPLATES.find(t => t.id === id) || TEMPLATES[0];
}
