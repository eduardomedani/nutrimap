// ═══════════════════════════════════════════════════════════
// UTILS — Funções utilitárias compartilhadas
// ═══════════════════════════════════════════════════════════

/**
 * Formata data ISO para formato brasileiro
 */
export function formatarData(dataIso) {
  if (!dataIso) return '—';
  const d = new Date(dataIso);
  if (isNaN(d.getTime())) return String(dataIso);
  return d.toLocaleDateString('pt-BR');
}

/**
 * Pega as iniciais de um nome (até 2 letras)
 */
export function iniciaisDoNome(nome) {
  if (!nome) return '?';
  return nome
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Copia texto para o clipboard e mostra toast
 */
export function copiarParaClipboard(texto, mensagem = '✓ Copiado!') {
  navigator.clipboard.writeText(texto);
  mostrarToast(mensagem);
}

/**
 * Mostra um toast no canto inferior direito
 */
export function mostrarToast(mensagem, duracaoMs = 2000) {
  const toast = document.createElement('div');
  toast.textContent = mensagem;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--text-primary, #1D2939);
    color: var(--text-on-primary, #FFFFFF);
    padding: 12px 18px;
    border-radius: 10px;
    font-size: 13px;
    z-index: 10000;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    animation: slideInRight 0.3s;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duracaoMs);
}

/**
 * Toast de ERRO — vermelho e mais demorado que o de sucesso.
 *
 * Substitui alert(): o browser pode DESLIGAR os diálogos nativos de uma aba
 * (basta o usuário marcar "impedir que esta página crie caixas de diálogo"),
 * e a partir daí todo alert() vira no-op — os erros somem sem deixar rastro.
 */
export function mostrarErro(mensagem, duracaoMs = 6000) {
  const toast = document.createElement('div');
  toast.textContent = String(mensagem ?? 'Erro inesperado');
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    max-width: 380px;
    background: var(--error, #EF4444);
    color: #fff;
    padding: 12px 18px;
    border-radius: 10px;
    font-family: 'Nunito', sans-serif;
    font-size: 13px;
    line-height: 1.45;
    z-index: 10000;
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
    animation: slideInRight 0.3s;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duracaoMs);
}

/**
 * Toast com ação de desfazer. Melhor que um modal de confirmação quando a ação
 * é pequena e reversível: não interrompe o fluxo e ainda protege do engano.
 * `aoDesfazer` roda se o usuário clicar antes do tempo acabar.
 */
export function mostrarToastDesfazer(mensagem, aoDesfazer, duracaoMs = 6000) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 10000;
    display: flex; align-items: center; gap: 14px;
    background: var(--text-primary, #1D2939); color: var(--text-on-primary, #FFFFFF);
    padding: 10px 12px 10px 18px; border-radius: 10px;
    font-family: 'Nunito', sans-serif; font-size: 13px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    animation: slideInRight 0.3s;
  `;

  const txt = document.createElement('span');
  txt.textContent = String(mensagem ?? '');

  const btn = document.createElement('button');
  btn.textContent = 'Desfazer';
  btn.style.cssText = `
    font-family: 'Nunito', sans-serif; font-size: 13px; font-weight: 800; cursor: pointer;
    background: transparent; border: 1.5px solid rgba(255,255,255,0.35);
    color: inherit; padding: 5px 12px; border-radius: 100px;
  `;

  const fim = setTimeout(() => toast.remove(), duracaoMs);
  btn.addEventListener('click', () => {
    clearTimeout(fim);
    toast.remove();
    try { aoDesfazer?.(); } catch (e) { mostrarErro('Não foi possível desfazer: ' + e.message); }
  });

  toast.append(txt, btn);
  document.body.appendChild(toast);
}

/**
 * Modal de confirmação. Devolve uma Promise<boolean>.
 *
 * Substitui confirm() pelo mesmo motivo do mostrarErro(): um confirm() barrado
 * retorna `false` na hora, sem perguntar nada — e a ação simplesmente não
 * acontece, sem erro. Aqui o diálogo é nosso, então nada pode desligá-lo.
 *
 * Fecha com Esc, clique no fundo ou nos botões. O foco vai para o botão de
 * cancelar, para o Enter não confirmar uma exclusão sem querer.
 */
export function confirmar(opcoes = {}) {
  // Aceita confirmar('mensagem') além de confirmar({ ... }).
  if (typeof opcoes === 'string') opcoes = { mensagem: opcoes };
  const {
    titulo = 'Confirmar',
    mensagem = '',
    textoOk = 'Confirmar',
    textoCancelar = 'Cancelar',
    perigo = false,
  } = opcoes;

  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.style.cssText = `
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(26,31,27,0.45);
      display: flex; align-items: center; justify-content: center; padding: 20px;
    `;

    const caixa = document.createElement('div');
    caixa.style.cssText = `
      background: var(--surface, #FFFFFF);
      border-radius: 16px; padding: 24px;
      width: 100%; max-width: 420px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      font-family: 'Nunito', sans-serif;
    `;

    const h = document.createElement('div');
    h.textContent = titulo;
    h.style.cssText = `font-size: 17px; font-weight: 800; color: var(--text-primary, #1D2939); margin-bottom: 8px;`;

    const p = document.createElement('div');
    p.textContent = mensagem;   // textContent, não innerHTML: a mensagem pode conter nome digitado pelo usuário
    p.style.cssText = `font-size: 14px; line-height: 1.5; color: var(--text-secondary, #667085); margin-bottom: 20px; white-space: pre-wrap;`;

    const acoes = document.createElement('div');
    acoes.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;

    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = textoCancelar;
    btnCancelar.style.cssText = `
      font-family: 'Nunito', sans-serif; font-size: 13.5px; font-weight: 700; cursor: pointer;
      padding: 9px 16px; border-radius: 100px;
      border: 1.5px solid var(--border, #E6E8EB); background: transparent; color: var(--text-primary, #1D2939);
    `;

    const btnOk = document.createElement('button');
    btnOk.textContent = textoOk;
    btnOk.style.cssText = `
      font-family: 'Nunito', sans-serif; font-size: 13.5px; font-weight: 700; cursor: pointer;
      padding: 9px 16px; border-radius: 100px; border: 1.5px solid transparent; color: #fff;
      background: ${perigo ? 'var(--error, #EF4444)' : 'var(--primary, #18B984)'};
    `;

    acoes.append(btnCancelar, btnOk);
    caixa.append(h, p, acoes);
    fundo.append(caixa);
    document.body.append(fundo);
    btnCancelar.focus();

    const fechar = (valor) => {
      document.removeEventListener('keydown', onKey);
      fundo.remove();
      resolve(valor);
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
    }

    document.addEventListener('keydown', onKey);
    btnCancelar.addEventListener('click', () => fechar(false));
    btnOk.addEventListener('click', () => fechar(true));
    // Só o clique no fundo cancela — dentro da caixa, não.
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(false); });
  });
}

/**
 * Gera link do WhatsApp pré-preenchido
 */
export function gerarLinkWhatsapp(mensagem, telefone = '') {
  const msg = encodeURIComponent(mensagem);
  const base = telefone
    ? `https://wa.me/${telefone.replace(/\D/g, '')}?text=${msg}`
    : `https://wa.me/?text=${msg}`;
  return base;
}

/**
 * Compõe a mensagem padrão para envio do questionário ao paciente
 */
export function montarMensagemQuestionario(nomeCompleto, link) {
  const primeiroNome = nomeCompleto ? nomeCompleto.split(' ')[0] + ', ' : '';
  return `Oi ${primeiroNome}aqui está seu questionário pré-consulta nutricional:\n\n${link}\n\nLeva entre 15 e 25 minutos. As respostas são salvas automaticamente — pode pausar e voltar quando quiser. 🌿`;
}
