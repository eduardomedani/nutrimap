// ═══════════════════════════════════════════════════════════
// SUPABASE — Configuração central do cliente
// Importado por todos os outros módulos
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jdtpludqkpvhnzkekrgm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdHBsdWRxa3B2aG56a2VrcmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzI4MTIsImV4cCI6MjA5ODMwODgxMn0.dgvZHm5sIGQqcC-ZpSsw8U-_ZlUQ49JHSwt4nE8VXu4';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// URL base do questionário (calculada a partir do local atual)
export const QUESTIONARIO_URL = (() => {
  const url = new URL(window.location.href);
  return url.origin + url.pathname.replace(/[^/]+$/, '');
})();
