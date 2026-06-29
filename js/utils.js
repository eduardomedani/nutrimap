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
    background: var(--moss-deep, #2A3A2C);
    color: var(--cream, #F8F1DD);
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
