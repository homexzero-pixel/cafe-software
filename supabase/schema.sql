-- Kaapi & Marble: Supabase schema (Postgres). Run once in the Supabase SQL editor,
-- then run supabase/seed.sql (made by: node tools/export-seed.js --sql).
--
-- Each table keeps the app's record as jsonb in `data`, plus indexed columns for
-- sorting, filtering and reports. Money is integer paise inside `data`.

create table if not exists public.settings (
  id   text primary key default 'cafe',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.dishes (          -- menu items with recipe [{ing, qty}]
  id   text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ingredients (     -- unit, base, baseAt, reorder, cost, supplier
  id   text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements ( -- purchase, waste, count
  id   text primary key,
  at   timestamptz not null default now(),
  data jsonb not null
);
create index if not exists stock_movements_at on public.stock_movements (at desc);

create table if not exists public.orders (
  id          text primary key,                      -- short order ID, e.g. KM-1043
  created_at  timestamptz not null default now(),
  status      text not null default 'new' check (status in ('new','preparing','ready','served','cancelled')),
  table_no    text,
  total_paise integer,
  data        jsonb not null,                        -- items, money, pay, log, use, inv
  updated_at  timestamptz not null default now()
);
create index if not exists orders_created on public.orders (created_at desc);
create index if not exists orders_status  on public.orders (status);

create table if not exists public.staff (           -- links a Supabase Auth user to a role
  user_id uuid primary key references auth.users (id) on delete cascade,
  name    text not null,
  role    text not null check (role in ('owner','cashier','staff')),
  created_at timestamptz not null default now()
);

-- Consecutive order numbers per café. One row, bumped atomically.
create table if not exists public.counter (
  id int primary key default 1 check (id = 1),
  no int not null default 1000
);
insert into public.counter (id, no) values (1, 1000) on conflict do nothing;

create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists t_settings on public.settings;     create trigger t_settings    before update on public.settings    for each row execute function public.touch();
drop trigger if exists t_dishes on public.dishes;         create trigger t_dishes      before update on public.dishes      for each row execute function public.touch();
drop trigger if exists t_ingredients on public.ingredients; create trigger t_ingredients before update on public.ingredients for each row execute function public.touch();
drop trigger if exists t_orders on public.orders;         create trigger t_orders      before update on public.orders      for each row execute function public.touch();

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;
create or replace function public.staff_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid()
$$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() = 'owner', false)
$$;

-- Next order number. Anyone may call it (guests place orders); the row lock makes it safe
-- when several phones order at once.
create or replace function public.next_order_no(floor_no int default 1000) returns int
language sql security definer set search_path = public as $$
  update public.counter set no = greatest(no, floor_no) + 1 where id = 1 returning no
$$;

create or replace function public.set_order_no(new_no int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.counter set no = greatest(no, new_no) where id = 1;
end $$;

-- Guests can mark their own order as "I've paid" (UPI) or record a test card payment.
-- They cannot change items, totals or status, and cannot mark a refund.
create or replace function public.customer_pay(order_id text, pay jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(pay->>'status','') not in ('pending','paid','unpaid') then raise exception 'bad payment status'; end if;
  update public.orders set data = jsonb_set(data, '{pay}', pay)
   where id = order_id and status <> 'cancelled'
     and coalesce(data->'pay'->>'status','unpaid') in ('unpaid','pending');
end $$;

-- Row level security
alter table public.settings        enable row level security;
alter table public.dishes          enable row level security;
alter table public.ingredients     enable row level security;
alter table public.stock_movements enable row level security;
alter table public.orders          enable row level security;
alter table public.staff           enable row level security;
alter table public.counter         enable row level security;

-- Guests read the menu, settings and stock (availability is worked out on the phone).
create policy read_settings on public.settings        for select using (true);
create policy read_dishes   on public.dishes          for select using (true);
create policy read_ingr     on public.ingredients     for select using (true);
create policy read_moves    on public.stock_movements for select using (true);
-- Orders are readable so stock and order tracking work without an account.
-- Customer names in orders are therefore visible to anyone with the anon key; keep them short (first name).
create policy read_orders   on public.orders          for select using (true);
-- Guests may place new, unpaid-or-pending orders only.
create policy guest_order   on public.orders          for insert with check (status = 'new' and coalesce(data->'pay'->>'status','unpaid') in ('unpaid','pending','paid'));

-- Roles: owner changes settings, ingredients and the team; any staff member runs orders,
-- marks dishes sold out and records stock movements. The app hides the rest by role too.
create policy owner_settings on public.settings        for all using (public.is_owner()) with check (public.is_owner());
create policy staff_dishes   on public.dishes          for all using (public.is_staff()) with check (public.is_staff());
create policy owner_ingr     on public.ingredients     for all using (public.is_owner()) with check (public.is_owner());
create policy owner_team     on public.staff           for all using (public.is_owner()) with check (public.is_owner());
create policy staff_moves    on public.stock_movements for all using (public.is_staff()) with check (public.is_staff());
create policy staff_orders   on public.orders          for all using (public.is_staff()) with check (public.is_staff());
create policy staff_self     on public.staff           for select using (user_id = auth.uid() or public.is_staff());

grant execute on function public.next_order_no(int)          to anon, authenticated;
grant execute on function public.customer_pay(text, jsonb)   to anon, authenticated;
grant execute on function public.set_order_no(int)           to authenticated;

-- Realtime: push row changes to every open portal and staff screen.
alter publication supabase_realtime add table public.settings, public.dishes, public.ingredients, public.stock_movements, public.orders;

-- If you created this schema before roles existed, run once:
--   alter table public.staff drop constraint if exists staff_role_check;
--   update public.staff set role = 'staff' where role = 'kitchen';
--   alter table public.staff add constraint staff_role_check check (role in ('owner','cashier','staff'));
-- After creating your first user in Authentication > Users, make them the owner:
--   insert into public.staff (user_id, name, role) values ('<user uuid>', 'Owner', 'owner');
