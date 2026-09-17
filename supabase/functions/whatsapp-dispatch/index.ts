// =============================================================================
// Di Tiglio — disparo de WhatsApp
//
// Lê a fila public.message_queue e envia as mensagens pendentes.
// O "driver" é trocável: hoje roda em modo LOG (não envia nada, só marca como
// enviado e grava o texto). Quando você contratar um provedor, basta definir
// a variável WHATSAPP_DRIVER e os segredos correspondentes.
//
// Deploy:
//   supabase functions deploy whatsapp-dispatch
//   supabase secrets set WHATSAPP_DRIVER=log
//
// Agende a cada 5 minutos em Database → Cron (ver README).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const DRIVER = Deno.env.get('WHATSAPP_DRIVER') ?? 'log';
const BATCH = 30;

/* ------------------------------------------------------------- textos ----- */

type Payload = Record<string, string | number>;

function renderMessage(template: string, p: Payload): string {
  const name = String(p.name ?? 'tudo bem').split(' ')[0];
  switch (template) {
    case 'appointment_confirmed':
      return `Olá, ${name}! Seu horário na Di Tiglio está confirmado ✂️\n\n`
        + `${p.service}\n${p.date} às ${p.time}\nValor: R$ ${p.price}\n\n`
        + `Precisa cancelar ou remarcar? É só entrar na sua conta no site.`;

    case 'appointment_awaiting_payment':
      return `Olá, ${name}! Separamos seu horário na Di Tiglio ✂️\n\n`
        + `${p.service}\n${p.date} às ${p.time}\nValor: R$ ${p.price}\n\n`
        + `Para garantir a reserva, falta o sinal de R$ ${p.deposit}. O link está na sua conta no site.`;

    case 'appointment_rescheduled':
      return `Olá, ${name}! Seu atendimento foi remarcado.\n\n`
        + `${p.service}\nNova data: ${p.date} às ${p.time}\n\nAté lá!`;

    case 'appointment_cancelled':
      return `Olá, ${name}. Seu horário de ${p.date} às ${p.time} foi cancelado`
        + `${p.by === 'barbearia' ? ' pela barbearia — desculpe o transtorno' : ''}.\n\n`
        + `Quando quiser, é só agendar de novo pelo site.`;

    case 'appointment_reminder':
      return `Olá, ${name}! Passando para lembrar do seu horário amanhã ✂️\n\n`
        + `${p.service}\n${p.date} às ${p.time}\n\nTe esperamos!`;

    case 'birthday':
      return `Feliz aniversário, ${name}! 🎉\n\n`
        + `A Di Tiglio preparou um presente: ${p.discount}% de desconto no seu próximo atendimento.\n\n`
        + `Use o cupom *${p.code}* ao agendar pelo site. Vale até ${p.valid_until}.`;

    default:
      return `Di Tiglio Barber Club — ${template}`;
  }
}

/* ------------------------------------------------------------ drivers ----- */

function toE164(raw: string): string {
  const digits = String(raw).replace(/\D/g, '');
  return digits.length <= 11 ? `55${digits}` : digits;
}

async function sendMeta(phone: string, text: string) {
  const id = Deno.env.get('META_PHONE_NUMBER_ID')!;
  const token = Deno.env.get('META_ACCESS_TOKEN')!;
  const res = await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: toE164(phone),
      type: 'text', text: { body: text }
    })
  });
  if (!res.ok) throw new Error(`Meta ${res.status}: ${await res.text()}`);
}

async function sendZapi(phone: string, text: string) {
  const instance = Deno.env.get('ZAPI_INSTANCE')!;
  const token = Deno.env.get('ZAPI_TOKEN')!;
  const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? '';
  const res = await fetch(`https://api.z-api.io/instances/${instance}/token/${token}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
    body: JSON.stringify({ phone: toE164(phone), message: text })
  });
  if (!res.ok) throw new Error(`Z-API ${res.status}: ${await res.text()}`);
}

async function sendTwilio(phone: string, text: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const auth = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM')!;   // ex.: whatsapp:+14155238886
  const body = new URLSearchParams({ From: from, To: `whatsapp:+${toE164(phone)}`, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${auth}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
}

async function deliver(phone: string, text: string) {
  if (DRIVER === 'meta') return sendMeta(phone, text);
  if (DRIVER === 'zapi') return sendZapi(phone, text);
  if (DRIVER === 'twilio') return sendTwilio(phone, text);
  console.log(`[log driver] para ${toE164(phone)}:\n${text}\n`);   // modo padrão
}

/* --------------------------------------------------------------- main ----- */

Deno.serve(async () => {
  const { data: settings } = await db.from('settings').select('whatsapp_enabled').eq('id', 1).maybeSingle();

  const { data: queued, error } = await db
    .from('message_queue')
    .select('*')
    .eq('status', 'queued')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for')
    .limit(BATCH);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // WhatsApp desligado nas configurações: marca como ignorado para a fila não crescer.
  if (!settings?.whatsapp_enabled) {
    const ids = (queued ?? []).map(m => m.id);
    if (ids.length) {
      await db.from('message_queue')
        .update({ status: 'skipped', error: 'whatsapp_enabled = false' })
        .in('id', ids);
    }
    return Response.json({ skipped: ids.length, driver: DRIVER, enabled: false });
  }

  let sent = 0, failed = 0;
  for (const msg of queued ?? []) {
    const text = renderMessage(msg.template, msg.payload ?? {});
    try {
      await deliver(msg.to_phone, text);
      await db.from('message_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: msg.attempts + 1, error: null })
        .eq('id', msg.id);
      sent++;
    } catch (e) {
      const attempts = msg.attempts + 1;
      await db.from('message_queue')
        .update({
          status: attempts >= 3 ? 'failed' : 'queued',
          attempts,
          error: String(e).slice(0, 400),
          scheduled_for: new Date(Date.now() + attempts * 10 * 60_000).toISOString()
        })
        .eq('id', msg.id);
      failed++;
    }
  }

  return Response.json({ sent, failed, driver: DRIVER });
});
