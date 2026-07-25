// ═══════════════════════════════════════════════════════════
// PACIENTE — Notificações push (Web Push / VAPID)
// ═══════════════════════════════════════════════════════════
// Fluxo: pede permissão → inscreve no PushManager (com a chave pública VAPID)
// → envia a inscrição ao backend (RPC). O envio em si é feito por uma Edge
// Function do Supabase quando o treino é atualizado. O Service Worker (sw.js)
// recebe o push e mostra a notificação.

import { sb } from './supabase.js';

// ⚠️ COLE AQUI a CHAVE PÚBLICA VAPID (gere com: npx web-push generate-vapid-keys).
// É pública — pode ficar no código do cliente. A privada vai como secret na Edge Function.
export const VAPID_PUBLIC_KEY = 'BNBopxeXNB4x-DleRSoDpt5ihJaFVE85hvZFKqT3F0hYvfQVPaK-gTfqAy1ygcz2zRN7Pi0H6bqpC63vxAzLLxI';

export function pushSuportado() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Já está ativo neste aparelho? (permissão concedida)
export function pushAtivo() {
  return pushSuportado() && Notification.permission === 'granted';
}

// base64url (VAPID) → Uint8Array exigido pelo pushManager.subscribe
function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Pede permissão, inscreve e registra no backend. Lança erro com código tratável.
export async function ativarNotificacoes() {
  if (!pushSuportado()) throw new Error('push_nao_suportado');
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith('COLE')) throw new Error('vapid_ausente');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permissao_negada');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const j = sub.toJSON();
  const { error } = await sb.rpc('rpc_paciente_salvar_push', {
    p_endpoint: sub.endpoint,
    p_p256dh: j.keys?.p256dh,
    p_auth: j.keys?.auth,
  });
  if (error) throw error;
  return true;
}

export async function desativarNotificacoes() {
  if (!pushSuportado()) return true;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await sb.rpc('rpc_paciente_remover_push', { p_endpoint: sub.endpoint }); } catch {}
    await sub.unsubscribe();
  }
  return true;
}

// Mensagens amigáveis para os erros de ativação.
export function traduzirPush(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('push_nao_suportado')) return 'Seu navegador não suporta notificações. No iPhone, instale o app na tela inicial primeiro.';
  if (m.includes('vapid_ausente'))      return 'Notificações ainda não configuradas pelo administrador.';
  if (m.includes('permissao_negada'))   return 'Você bloqueou as notificações. Libere nas configurações do navegador.';
  if (m.includes('sem_paciente'))       return 'Sua conta não está vinculada. Informe seu código de acesso.';
  return 'Não foi possível ativar as notificações. Tente de novo.';
}
