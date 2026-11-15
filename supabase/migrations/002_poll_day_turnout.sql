-- Poll day: votes polled so far at each polling station, reported in time slots
-- (9 AM, 11 AM, 1 PM, 3 PM, 5 PM and close of poll). Counts only: no voter-level
-- data and nothing about how anyone voted.
--
-- Also created on first use by netlify/functions/turnout.mts, so an existing
-- database picks it up without re-running setup.

create table if not exists turnout_reports (
  booth_id    text not null references booths (id) on delete cascade,
  slot        smallint not null check (slot in (9, 11, 13, 15, 17, 19)),  -- hour; 19 = close of poll
  votes       integer not null check (votes between 0 and 5000),
  reported_by bigint references app_users (id) on delete set null,
  reported_at timestamptz not null default now(),
  primary key (booth_id, slot)
);

alter table turnout_reports enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on turnout_reports from %I', r);
    end if;
  end loop;
end $$;
