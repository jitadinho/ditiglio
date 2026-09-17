// =============================================================================
// Di Tiglio — rotinas diárias
//
// 1. Cria os cupons de aniversário do dia e enfileira a mensagem.
// 2. Enfileira os lembretes dos atendimentos de amanhã.
//
// Deploy:  supabase functions deploy daily-routines
// Agende uma vez por dia, de manhã (ver README).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  const [birthdays, reminders] = await Promise.all([
    db.rpc('queue_birthday_campaign'),
    db.rpc('queue_appointment_reminders')
  ]);

  return Response.json({
    ran_at: new Date().toISOString(),
    birthday_coupons: birthdays.data ?? 0,
    birthday_error: birthdays.error?.message ?? null,
    reminders: reminders.data ?? 0,
    reminders_error: reminders.error?.message ?? null
  });
});
