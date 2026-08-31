-- Request app V1 — Supabase schema + security rules
-- Run this once in the Supabase SQL editor (paste the whole file, hit Run).

-- ============ tables ============

create table if not exists buildings (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- the bit in the link: request.html?b=harbourview
  name text not null,
  address text,
  lat double precision,               -- optional; fills the mini map on the detail screen
  lng double precision
);

-- Reference numbers come from the database, never from the browser. A random
-- 4-digit ref collides fast (roughly 43% odds of a duplicate by the 100th job),
-- and two jobs sharing a number is a real mess the day a customer rings quoting one.
create sequence if not exists request_ref_seq start with 1001;

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null default 'R-' || nextval('request_ref_seq'),
  building_code text not null,
  building_name text not null,
  category text not null,
  req_type text,                       -- service / quote / urgent / other (the customer's pick)
  scc_amount numeric,                  -- the locked call-out figure. Urgent: frozen when the customer taps Accept.
                                       -- Service (2026-08-26 rule): null at send, written when the office books the
                                       -- visit — the booked time picks the rate. Old rows keep their send-time figure.
  scc_accepted boolean default false,  -- they tapped Accept before sending (on service that means the whole rate card)
  rate_type text,                      -- which rate the locked figure is: 'normal hours' / 'after hours' / 'Saturday' / …
  rate_card jsonb,                     -- service only: the card accepted at send, e.g.
                                       -- {"normal":75,"after":180,"window":"Mon–Fri, 8am–4pm","label":"ex GST"}
  hourly_amount numeric,               -- $/hr after the first hour, as shown to the customer at accept (null = not configured)
  answers jsonb default '[]',
  urgent boolean default false,
  note text,
  avail_days jsonb default '[]',
  time_pref text,
  customer_name text not null,
  requester_role text,                 -- who's asking: building manager / strata manager / property manager / facilities manager / owner / tenant / other
  customer_phone text not null,        -- stored normalised: 0412345678, never '+61 412 345 678'
  phone_kind text,                     -- 'mobile' or 'landline' — a landline can't receive the update texts
  customer_email text,                 -- where quotes and paperwork get sent; required on those paths (2026-08-28)
  afss_due date,                       -- certification deadline, when the customer gave one (2026-08-28)
  photo text,                          -- first photo, kept so older code paths still read
  photos jsonb default '[]',           -- every photo they attached (up to 4, compressed jpeg data URLs)
  docs jsonb default '[]',             -- PDFs attached alongside the photos (defect reports etc), ≤4MB all up
  specs_have text,                     -- quote only: 'Yes'/'No' to "do you have plans or drawings?"
  specs_files jsonb default '[]',      -- quote only: attached specs (PDF or image data URLs, ≤4MB all up)
  status text not null default 'new' check (status in ('new','booked','done','declined')),
  assignees jsonb default '[]',        -- names of everyone on the job (can be a crew)
  booked_label text,
  declined_reason text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  at timestamptz not null default now(),
  text text not null,
  sms boolean default false
);

-- who's allowed into the company side (add emails here)
create table if not exists company_users (
  email text primary key
);

-- ============ the allowlist ============
-- CHANGE THIS to Noah's email before running:
insert into company_users (email) values ('noah.owens12@icloud.com')
on conflict do nothing;

-- ============ seed buildings ============
insert into buildings (code, name, address) values
  ('harbourview', 'Harbourview Apartments', '12 Harbour St'),
  ('seaforth-rsl', 'Seaforth RSL', '3 Frenchs Rd')
on conflict (code) do nothing;

-- ============ 'received' events happen automatically ============

-- Wording must match smsText('received') in store.js — company name and phone are
-- hardcoded here because the trigger can't read config.js; keep the three in sync.
-- (Old trigger text had drifted: still carried the ref number and skipped the company
-- name, both dropped in the 2026-08-10 rewording. Urgent valve added 2026-08-17.)
create or replace function add_received_events() returns trigger
language plpgsql security definer as $$
begin
  insert into request_events (request_id, text, sms) values
    (new.id, 'received · ' || split_part(new.customer_name, ' ', 1) || ' got a receipt', false);
  -- a landline can't receive the receipt text — log the truth, not a text that never lands
  -- (2026-08-28; matches DemoStore.createRequest in store.js)
  if new.phone_kind = 'landline' then
    insert into request_events (request_id, text, sms) values
      (new.id, 'receipt not texted — landline, give them a ring', false);
  else
    insert into request_events (request_id, text, sms) values
      (new.id, 'SMS→ Got it, ' || split_part(new.customer_name, ' ', 1) ||
               '. This is Astute Fire, you''ll hear from us soon.' ||
               case when new.urgent then ' If it gets worse, ring us on (02) 9481 0000.' else '' end, true);
  end if;
  -- the urgent ping (2026-08-31): the on-call person gets told the moment an urgent
  -- lands. Wording must match alertText() in store.js — no config here, so the words
  -- are built from the request's own columns and nothing is hardcoded to keep in sync.
  -- Sits in the record, never in the customer's thread (no sms flag).
  if new.urgent then
    insert into request_events (request_id, text) values
      (new.id, 'ALERT→ URGENT — ' || new.building_name || '. ' || new.category || '. '
        || new.customer_name || ', ' || new.customer_phone || '. ' || new.ref || '.');
  end if;
  -- the accepted call-out goes on the record, timestamped
  -- (wording matches DemoStore.createRequest in store.js — keep the two in sync)
  if new.scc_accepted and new.scc_amount is not null then
    insert into request_events (request_id, text) values
      (new.id, 'call-out accepted · $' || new.scc_amount::text || ' ex GST'
        || case when new.rate_type is not null and new.rate_type <> 'normal hours'
                then ' · ' || new.rate_type else '' end
        || case when new.hourly_amount is not null
                then ' · then $' || new.hourly_amount::text || '/hr' else '' end);
  -- service under the 2026-08-26 rule: the customer accepted the whole rate card,
  -- no single figure exists yet — the booked time locks one in later
  elsif new.scc_accepted and new.rate_card is not null then
    insert into request_events (request_id, text) values
      (new.id, 'rate card accepted · $' || (new.rate_card->>'normal') || ' '
        || coalesce(new.rate_card->>'window','') || ' / $' || (new.rate_card->>'after') || ' outside'
        || case when new.hourly_amount is not null
                then ' · then $' || new.hourly_amount::text || '/hr' else '' end);
  end if;
  return new;
end $$;

drop trigger if exists trg_received on requests;
create trigger trg_received after insert on requests
for each row execute function add_received_events();

-- ============ row-level security ============

alter table buildings enable row level security;
alter table requests enable row level security;
alter table request_events enable row level security;
alter table company_users enable row level security;

-- is the signed-in user on the allowlist?
create or replace function is_company() returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from company_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- buildings: anyone can look one up (the form needs the name); only company changes them
drop policy if exists bld_read on buildings;
create policy bld_read on buildings for select using (true);

-- requests: anyone can CREATE one (that's the product) — but only as a fresh 'new'
-- request with nobody on it; reading and changing is company-only.
drop policy if exists req_insert on requests;
create policy req_insert on requests for insert
  with check (status = 'new' and (assignees is null or assignees = '[]'::jsonb) and booked_label is null and declined_reason is null);

drop policy if exists req_read on requests;
create policy req_read on requests for select using (is_company());

drop policy if exists req_update on requests;
create policy req_update on requests for update using (is_company());

-- events: company reads and writes; the received-trigger writes via security definer
drop policy if exists ev_read on request_events;
create policy ev_read on request_events for select using (is_company());

drop policy if exists ev_insert on request_events;
create policy ev_insert on request_events for insert with check (is_company());

-- company_users: nobody reads or writes it from the app (managed in the dashboard)
-- (no policies = locked; is_company() reads it via security definer)

-- ============ realtime ============
-- lets the list update live without refreshing
do $$ begin
  alter publication supabase_realtime add table requests;
exception when duplicate_object then null;
end $$;

-- ============ customer follow-up note ============
-- The receipt's "Forgot something?" link. Anon can't touch requests or events
-- directly, so this runs as security definer: checks the request is real and
-- fresh (24h), then adds the note to the timeline. Nothing is ever returned.

create or replace function add_customer_note(req_id uuid, note text)
returns void language plpgsql security definer as $$
begin
  if note is null or length(trim(note)) = 0 or length(note) > 500 then return; end if;
  if not exists (
    select 1 from requests where id = req_id and created_at > now() - interval '24 hours'
  ) then return; end if;
  insert into request_events (request_id, text)
  values (req_id, 'customer added · “' || trim(note) || '”');
end $$;
grant execute on function add_customer_note(uuid, text) to anon, authenticated;

-- Safe to re-run on a database created before refs were sequenced:
-- points the column at the sequence and starts it past whatever's already there.
do $$
begin
  perform setval('request_ref_seq',
    greatest(1001, coalesce((select max(nullif(regexp_replace(ref,'[^0-9]','','g'),'')::bigint) from requests), 1000) + 1),
    false);
exception when others then null;
end $$;

alter table requests alter column ref set default 'R-' || nextval('request_ref_seq');

-- No two jobs can ever share a reference, whatever else goes wrong.
create unique index if not exists requests_ref_unique on requests (ref);

-- Safe to re-run: adds the photos column to a database made before multi-photo.
alter table requests add column if not exists photos jsonb default '[]';
alter table requests add column if not exists phone_kind text;
-- Safe to re-run: quote specs question added 2026-08-26.
alter table requests add column if not exists specs_have text;
alter table requests add column if not exists specs_files jsonb default '[]';
alter table requests add column if not exists requester_role text;
alter table requests add column if not exists hourly_amount numeric;
alter table requests add column if not exists docs jsonb default '[]';
-- Safe to re-run: rate card flow added 2026-08-27 (service rate locks at booking).
alter table requests add column if not exists rate_card jsonb;
-- Safe to re-run: email + AFSS deadline added 2026-08-28 (review).
alter table requests add column if not exists customer_email text;
alter table requests add column if not exists afss_due date;
