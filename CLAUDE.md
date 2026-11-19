# Kaapi & Marble: café software

Two apps for an Indian café, built from one source into separate pages that share storage: `dist/index.html` (customers), `dist/cafe.html` (staff) and `dist/demo.html` (both, used by the e2e tests). `window.KM_APP` ('customer', 'cafe', 'both') picks the routes in `app.js`.
- **Customer portal** (phones): menu, 3D dishes, a camera "table view" where guests swipe through dishes placed on their table, cart with GST bill, UPI / card / pay-at-counter, and bills with order IDs.
- **Café manager** (staff, PIN 1234 by default): overview dashboard, kitchen order tickets (KOT), billing (POS), bills, menu editor, recipe-based stock, GST reports, table QR codes, setup.

Plain JavaScript (ES2020), no framework and no runtime dependencies. The build inlines everything into one self-contained `dist/index.html`.

## Commands

- Build: `node build.mjs` (or `python3 build.py`). Output: `dist/index.html`, `dist/cafe.html`, `dist/demo.html`. Rebuild after every change in `src/`.
- Run locally: `npx serve dist`, then open http://localhost:3000. The live camera needs HTTPS or localhost.
- Unit tests: `npm test` (geometry winding, GST billing math, stock and availability).
- QR tests: `npm i && npm run test:qr` (needs `pip install opencv-python`).
- End-to-end: `pip install playwright opencv-python && playwright install chromium`, then `npm run test:e2e`. Screenshots land in `shots/`. Set `CHROME_PATH` to use an installed Chrome.
- Preview all 3D dishes: open `test/dishes.html` in a browser.

## Source layout (`src/`, concatenated in this order by the build)

| File | Global | What it does |
|---|---|---|
| `engine.js` | `E3` | Small WebGL1 renderer: geometry builders (lathe, tube, extrude, rounded box), canvas textures, PBR-style shader with wrap lighting, procedural bump and browning, shadow map, shadow catcher for compositing over a camera feed |
| `models.js` | `Dishes` | 18 procedural dishes at real-world scale in metres (`Dishes.get(key)`), plus the marble table. Keys are stored on each menu item as `model` |
| `qr.js` | `QR` | QR encoder, `QR.svg(text)` |
| `data.js` | `Data` | Defaults (settings, menu, stock), billing math, stock and availability, storage adapters, sample sales |
| `ui.js` | `UI` | DOM helpers, icons, toasts, dialogs, downloads, audio chime |
| `viewer.js` | `Viewer` | One shared WebGL canvas moved between stages, orbit controller, dish thumbnails |
| `ar.js` | `AR` | Table view: live camera with gyroscope anchoring, photo of the table, virtual marble table, WebXR hit-test placement on Android Chrome |
| `customer.js` | `Cust`, `Invoice` | Customer portal screens and the GST invoice |
| `staff.js` | `Staff` | Staff software screens |
| `app.js` | | Boot and hash router |
| `styles.css`, `template.html` | | Styles and page shell |

Routes (hash): customer `#table-N`, `#menu`, `#ar`, `#cart`, `#bills`; café dashboard `#overview`, `#orders`, `#billing`, `#bills`, `#menu`, `#stock`, `#reports`, `#board` (pickup TV), `#tables`, `#setup` (in demo.html they are prefixed `#staff-`, plus `#welcome`).

## Data model

Document paths: `cafe/settings`, `menu/{id}`, `stock/{id}`, `orders/{id}`, `ledger/{id}`, `meta/counter`.

- **Dish**: `name, category, price` (rupees, before GST), `veg, model, kcal, prep, from, to` ("HH:MM" or empty for all day), `desc, tags, active, sort, recipe: [{ing, qty}]` (per serving, in the ingredient's unit), optional `options: [{name, many, choices: [{n, p, r}]}]` (customisation; `p` extra ₹, `r` extra ingredients; without it the category's set in `CATEGORY_OPTIONS` applies, `[]` turns it off).
- **Ingredient**: `name, unit` (g, ml, pc, slice), `base, baseAt` (counted quantity and when), `reorder, cost` (₹ per unit), `supplier`.
- **Ledger entry**: `at, ing, type` (purchase, waste, count), `qty` (signed), `cost, note`.
- **Order**: `id` (KM-1043), `no, inv` (KM/26-27/1043), `createdAt, table, type` (dine-in, takeaway), `source` (portal, pos), `customer, items[]` (each with `opts` names), optional `phone` (rewards), `beans` (redeemed), `pickupAt`, money fields `sub, disc, taxable, cgst, sgst, round, total` (integer paise), `rate, incl, status` (new, preparing, ready, served, cancelled), `log[]`, `use` (ingredient consumption snapshot), `pay {method, status, ref, last4, ...}`, `demo` for sample sales.

## Rules that matter

- **Money is integer paise.** `Data.bill()` is the only place tax is computed. Exclusive prices: CGST = SGST = round(taxable × rate / 200). Totals round to the rupee with a visible round-off line.
- **GST**: 5% without ITC for a standalone café (18% option for hotel premises). SAC 996331 prints on bills.
- **FSSAI**: the 14-digit licence number must print on every bill.
- **No automatic service charge.** It must stay voluntary, so the software never adds one.
- **Invoice numbers** are consecutive per financial year (April to March): `PREFIX/YY-YY/NNNN`.
- **Stock is derived, not decremented**: stock = `base` (at `baseAt`) + ledger entries after `baseAt` − `use` of non-cancelled orders created at or after `baseAt`. A stock count resets `base` and `baseAt`. This avoids lost updates when several devices order at once.
- **Rewards are derived too** (`Data.beans`): 1 bean per `beanPer` ₹ of paid, non-cancelled bills, minus `beans` redeemed. Redemption is a discount (`disc`) before GST.
- **Availability** (`Data.dishStatus`): on the menu, inside serving hours (when `settings.timeMenus` is on), and enough stock for one more portion after what is already in the cart.
- Escape every data string with `UI.esc()` when building HTML.
- Copy style: sentence case, plain verbs, no all-caps labels.

## Storage

`Data.init()` picks an adapter:
- Inside the Claude artifact viewer it uses the runtime's shared database (`claude.use('db')`, a Firestore-style API). The order counter uses a short lease (`acquire`).
- With `config.json` (Supabase URL + anon key, see `config.example.json`) the build sets `window.KM_CONFIG` and it uses **Supa**: Supabase tables (`supabase/schema.sql`), Realtime for live updates, `next_order_no()` RPC for the counter, `customer_pay()` RPC for guest payment claims, and Supabase Auth email sign-in for staff (a row in `staff`). Seed with `node tools/export-seed.js --sql` then run `supabase/seed.sql`.
- Anywhere else it uses **Local**: localStorage plus BroadcastChannel, so tabs in one browser stay in sync, but phones and the counter do not.

**To sync real devices on your own hosting**, add an adapter with the same methods as `Cloud` in `data.js` (`setSettings, putDish, delDish, putStock, delStock, nextNo, putOrder, patchOrder, putOrders, delOrders, addLedger, seed`) and select it in `Data.init()`. Firebase Firestore's API is almost identical to the one `Cloud` already uses; replace `acquire` with a transaction for `nextNo`. Supabase works too, with realtime subscriptions per table. `node tools/export-seed.js` exports the starter data as write operations.

## Browser limits to keep in mind

- iPhone Safari has no WebXR AR, so `ar.js` uses camera feed + gyroscope there; WebXR hit-test only runs on Android Chrome with ARCore.
- Camera and motion sensors need HTTPS (or localhost) and a user tap; iOS also needs `DeviceOrientationEvent.requestPermission()`.
- Inside the Claude preview the camera, `window.print` and plain downloads are blocked; the code falls back to a photo of the table and the downloads capability.

## Next steps

1. Role-based screens (owner, cashier, kitchen) on top of the Supabase staff accounts; move customer names out of the publicly readable orders table.
2. Razorpay Checkout in the portal (the webhook is ready in `supabase/functions/razorpay-webhook`). The card form is test mode only (4111 1111 1111 1111 passes, 4000 0000 0000 0002 is declined).
3. Real dish scans: upload a GLB per dish (with a USDZ for iPhone Quick Look) and load it with a glTF loader, keeping the procedural models as fallback.
4. Thermal printer support (ESC/POS) for KOTs and bills, offline mode (PWA), multiple outlets.
5. Replace the placeholder GSTIN, FSSAI number, UPI ID and address in `SETTINGS` (`data.js`) or in Setup.

`DESIGN.md` records the visual direction: coffee brown and caramel on warm white, a marble-table motif, Yatra One for the wordmark and Anek Latin for the interface.
