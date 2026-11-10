-- Kukatpally Drilldown: users, roles, area assignments and citizen help requests.
--
-- Run once in Supabase → SQL Editor (paste the whole file, click Run).
-- Then run supabase/seed.sql for the synthetic demo team and requests.
--
-- Access model: ONLY the site's server functions (Netlify) talk to this database,
-- over the DATABASE_URL connection. Row-level security is enabled on every table
-- with no policies, so Supabase's public REST/GraphQL APIs (anon / authenticated
-- keys) can read or change nothing. Role checks ("a booth lead sees only their
-- booths") are enforced by the server functions on every query.
--
-- No amounts / budgets anywhere, and no caste or voting data: help requests
-- record that a person needs help applying to a government scheme, with consent.

begin;

-- Roles -------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin', 'unit_lead', 'booth_lead');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum ('new', 'documents_pending', 'applied', 'resolved', 'not_eligible', 'closed');
exception when duplicate_object then null; end $$;

-- People who sign in (party / office team — not voters) ----------------------------
create table if not exists app_users (
  id            bigint generated always as identity primary key,
  username      text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$'),
  name          text not null,
  role          user_role not null,
  -- PBKDF2-SHA256 hash ("pbkdf2-sha256$iterations$salt$hash"), never a password
  password_hash text not null,
  phone         text,                          -- optional, for the team directory
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Polling stations and the ward / mandal ("unit") each falls in -----------------
-- Mirrors src/data/booths.json so the server can scope by area without the map.
create table if not exists booths (
  id        text primary key,                  -- "46-172" = AC 46, PS 172
  ac        smallint not null,
  ps_no     smallint not null,
  unit_id   text,                              -- "ward-117", "mandal-ghattu"
  unit_name text,
  name      text not null,
  unique (ac, ps_no)
);
create index if not exists booths_unit_idx on booths (unit_id);

-- Who leads what: a unit lead gets ward/mandal rows, a booth lead gets booth rows
create table if not exists assignments (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references app_users (id) on delete cascade,
  unit_id    text,
  booth_id   text references booths (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((unit_id is null) <> (booth_id is null))
);
create unique index if not exists assignments_unit_uq on assignments (user_id, unit_id) where unit_id is not null;
create unique index if not exists assignments_booth_uq on assignments (user_id, booth_id) where booth_id is not null;
create index if not exists assignments_booth_idx on assignments (booth_id);
create index if not exists assignments_unit_idx on assignments (unit_id);

-- Government schemes people can be helped to apply for ---------------------------
create table if not exists schemes (
  code   text primary key,
  name   text not null,
  sort   smallint not null default 100,
  active boolean not null default true
);

-- Help requests: a person needs help applying for a scheme -------------------------
create table if not exists help_requests (
  id             bigint generated always as identity primary key,
  booth_id       text not null references booths (id),
  voter_serial   integer not null,               -- serial on that station's list
  voter_ref      text not null,                  -- voter ID shown on the roll (sample: SMP…)
  voter_name     text not null,                  -- copy, so the list reads without the roll
  scheme_code    text not null references schemes (code),
  need           text not null check (length(need) between 3 and 500),
  contact_mobile text check (contact_mobile is null or contact_mobile ~ '^[6-9][0-9]{9}$'),
  consent        boolean not null check (consent),          -- must be true to save
  consent_at     timestamptz not null default now(),
  status         request_status not null default 'new',
  created_by     bigint not null references app_users (id),
  assigned_to    bigint references app_users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists help_requests_booth_idx on help_requests (booth_id);
create index if not exists help_requests_status_idx on help_requests (status);
create unique index if not exists help_requests_one_open_per_scheme
  on help_requests (booth_id, voter_serial, scheme_code)
  where status in ('new', 'documents_pending', 'applied');

-- Every change, for accountability ----------------------------------------------
create table if not exists request_events (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references help_requests (id) on delete cascade,
  user_id     bigint not null references app_users (id),
  action      text not null,                    -- created / status / note / assigned
  from_status request_status,
  to_status   request_status,
  note        text check (note is null or length(note) <= 1000),
  at          timestamptz not null default now()
);
create index if not exists request_events_request_idx on request_events (request_id, at);

-- Lock down Supabase's public APIs ----------------------------------------------
alter table app_users      enable row level security;
alter table booths         enable row level security;
alter table assignments    enable row level security;
alter table schemes        enable row level security;
alter table help_requests  enable row level security;
alter table request_events enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on app_users, booths, assignments, schemes, help_requests, request_events from %I', r);
    end if;
  end loop;
end $$;

-- Scheme list -------------------------------------------------------------------
insert into schemes (code, name, sort) values
  ('aasara',          'Aasara pension',                       10),
  ('kalyana_lakshmi', 'Kalyana Lakshmi / Shaadi Mubarak',     20),
  ('indiramma_house', 'Indiramma housing',                    30),
  ('rythu_bharosa',   'Rythu Bharosa',                        40),
  ('mahalakshmi',     'Mahalakshmi',                          50),
  ('gruha_jyothi',    'Gruha Jyothi',                         60),
  ('arogyasri',       'Aarogyasri health cover',              70),
  ('ration_card',     'Ration card (new / correction)',       80),
  ('other',           'Other scheme',                        999)
on conflict (code) do update set name = excluded.name, sort = excluded.sort;

commit;
