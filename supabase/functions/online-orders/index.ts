// Online orders from Zomato, Swiggy or ONDC -> the café's orders table, so they appear on the kitchen board
// (and print a KOT on the device set to auto-print) without anyone retyping them.
//
// Zomato and Swiggy don't send orders to restaurants directly: they go through a POS integration partner
// (Zomato's POS developer platform, or middleware such as UrbanPiper). Point that partner's order webhook here,
// or add a small mapping in `normalise()` for its payload. Deploy:
//   supabase functions deploy online-orders --no-verify-jwt
//   supabase secrets set ONLINE_ORDERS_SECRET=<long random string>
// Requests must send the header  x-km-secret: <that string>.
//
// Body (the simple format this function understands):
// { "channel": "zomato" | "swiggy" | "ondc", "ext_id": "5123456789",
//   "items": [{ "id": "cappuccino" (our dish id, optional), "name": "Cappuccino", "qty": 2, "price": 199, "note": "less sugar", "options": ["Large"] }],
//   "type": "delivery" | "pickup", "instructions": "Ring the bell", "placed_at": "2026-11-19T10:15:00+05:30" }
//
// GST: the app charges and pays 5% GST on these orders under section 9(5), so they are saved with no café
// CGST/SGST (eco: true) and no invoice number from the café's series.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CODES: Record<string, string> = { zomato: 'ZO', swiggy: 'SW', ondc: 'ON' };
type Item = { id?: string; name?: string; qty?: number; price?: number; note?: string; options?: string[] };

function normalise(body: any) {
  // UrbanPiper-style payloads: { order: { details: { channel, ext_platforms: [{ id }] }, items: [{ title, quantity, price, merchant_id }] } }
  if (body?.order?.items) {
    const o = body.order, d = o.details || {};
    return {
      channel: String(d.channel || body.channel || '').toLowerCase(),
      ext_id: String(d.ext_platforms?.[0]?.id ?? d.id ?? ''),
      type: d.order_type === 'pickup' ? 'pickup' : 'delivery',
      instructions: d.instructions || '',
      placed_at: d.created ? new Date(d.created).toISOString() : undefined,
      items: o.items.map((i: any) => ({ id: i.merchant_id, name: i.title, qty: i.quantity, price: i.price, note: i.instructions, options: (i.options_to_add || []).map((x: any) => x.title) })),
    };
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = Deno.env.get('ONLINE_ORDERS_SECRET') || '';
  if (!secret || req.headers.get('x-km-secret') !== secret) return new Response('unauthorised', { status: 401 });

  const b = normalise(await req.json().catch(() => null));
  const channel = String(b?.channel || '').toLowerCase(), extId = String(b?.ext_id || '').trim();
  if (!CODES[channel] || !extId || !Array.isArray(b.items) || !b.items.length) return new Response('need channel, ext_id and items', { status: 400 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // the same app order sent twice is saved once
  const dup = await sb.from('orders').select('id').eq('data->>channel', channel).eq('data->>extId', extId).maybeSingle();
  if (dup.data) return Response.json({ ok: true, id: dup.data.id, duplicate: true });

  const dishes = (await sb.from('dishes').select('id,data')).data || [];
  const byId = new Map(dishes.map((d: any) => [d.id, d.data]));
  const byName = new Map(dishes.map((d: any) => [String(d.data.name).toLowerCase(), { id: d.id, ...d.data }]));
  const items = [], use: Record<string, number> = {};
  for (const raw of b.items as Item[]) {
    const qty = Math.max(1, Math.round(Number(raw.qty) || 1));
    const dish: any = (raw.id && byId.has(raw.id) && { id: raw.id, ...byId.get(raw.id) }) || byName.get(String(raw.name || '').toLowerCase()) || null;
    const price = Number(raw.price) > 0 ? Number(raw.price) : dish ? Number(dish.price) : 0;
    items.push({ id: dish ? dish.id : `app-${String(raw.name || 'item').toLowerCase().replace(/\W+/g, '-')}`, name: dish ? dish.name : String(raw.name || 'Item'), price, qty, note: raw.note || '', veg: dish ? dish.veg !== false : true, model: dish ? dish.model : 'cappuccino', opts: raw.options || [] });
    for (const r of (dish && dish.recipe) || []) use[r.ing] = (use[r.ing] || 0) + r.qty * qty;
  }
  // the same arithmetic as Data.bill() with rate 0: integer paise, total rounded to the rupee
  const sub = items.reduce((a, l) => a + Math.round(l.price * 100) * l.qty, 0), total = Math.round(sub / 100) * 100;
  const now = b.placed_at ? Date.parse(b.placed_at) || Date.now() : Date.now();
  let id = `${CODES[channel]}-${extId.replace(/\W/g, '').slice(-6).toUpperCase()}`;
  if ((await sb.from('orders').select('id').eq('id', id).maybeSingle()).data) id += '-' + Date.now().toString(36).slice(-3).toUpperCase();

  const data = {
    no: null, inv: null, createdAt: now, table: null, type: b.type === 'pickup' ? 'pickup' : 'delivery', source: channel, channel, extId, eco: true, customer: null,
    items, status: 'new', log: [{ s: 'new', at: now, by: channel }], use, note: String(b.instructions || '').slice(0, 200),
    pay: { method: 'online', status: 'paid', channel, at: now }, by: channel,
    sub, disc: 0, taxable: sub, cgst: 0, sgst: 0, round: total - sub, total, rate: 0, incl: false,
  };
  const ins = await sb.from('orders').insert({ id, created_at: new Date(now).toISOString(), status: 'new', table_no: null, total_paise: total, data });
  if (ins.error) return new Response(ins.error.message, { status: 500 });
  return Response.json({ ok: true, id });
});
