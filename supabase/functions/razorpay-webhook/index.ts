// Razorpay webhook -> marks an order paid. Deploy:
//   supabase functions deploy razorpay-webhook --no-verify-jwt
//   supabase secrets set RAZORPAY_WEBHOOK_SECRET=...
// In the Razorpay dashboard add the webhook URL https://<project>.supabase.co/functions/v1/razorpay-webhook
// for the event payment.captured. Create each Razorpay order with notes.order_id = the café order ID (KM-1043).
import { createClient } from 'npm:@supabase/supabase-js@2';

const enc = new TextEncoder();
async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const body = await req.text();
  const sig = req.headers.get('x-razorpay-signature') || '';
  const expected = await hmacHex(Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '', body);
  if (!sig || !safeEqual(sig, expected)) return new Response('bad signature', { status: 401 });

  const ev = JSON.parse(body);
  if (ev.event !== 'payment.captured') return new Response('ignored');
  const p = ev.payload?.payment?.entity;
  const orderId = p?.notes?.order_id;
  if (!orderId) return new Response('no order id', { status: 400 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: row, error } = await sb.from('orders').select('data').eq('id', orderId).single();
  if (error || !row) return new Response('order not found', { status: 404 });
  if (row.data.total !== p.amount) return new Response('amount mismatch', { status: 409 }); // both in paise

  const pay = {
    ...(row.data.pay || {}), method: p.method === 'upi' ? 'upi' : 'card', status: 'paid', gateway: 'razorpay',
    ref: p.id, last4: p.card?.last4 ?? null, paidAt: p.captured_at ? p.captured_at * 1000 : Date.now(),
  };
  await sb.from('orders').update({ data: { ...row.data, pay } }).eq('id', orderId);
  return new Response('ok');
});
