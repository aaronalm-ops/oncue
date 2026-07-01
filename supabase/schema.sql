-- OnCue database schema
-- Run this in your Supabase SQL editor

-- Profiles (extends Supabase auth.users)
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  instrument text,
  display_name text,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Services
create table services (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  day_of_week text not null check (day_of_week in ('THURSDAY', 'SATURDAY')),
  source_filename text not null,
  uploaded_at timestamptz default now(),
  instruments text[] not null default '{}'
);
alter table services enable row level security;
create policy "Authenticated users can view services" on services for select to authenticated using (true);
create policy "Authenticated users can insert services" on services for insert to authenticated with check (true);
create policy "Authenticated users can update services" on services for update to authenticated using (true);

-- Songs
create table songs (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services on delete cascade,
  order_index int not null,
  title text not null,
  scale text,
  medley_group text,
  reference_links text[] not null default '{}'
);
alter table songs enable row level security;
create policy "Authenticated users can view songs" on songs for select to authenticated using (true);
create policy "Authenticated users can insert songs" on songs for insert to authenticated with check (true);
create policy "Authenticated users can update songs" on songs for update to authenticated using (true);
create policy "Authenticated users can delete songs" on songs for delete to authenticated using (true);

-- Sections
create table sections (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs on delete cascade,
  order_index int not null,
  label text not null,
  comments text not null default ''
);
alter table sections enable row level security;
create policy "Authenticated users can view sections" on sections for select to authenticated using (true);
create policy "Authenticated users can insert sections" on sections for insert to authenticated with check (true);
create policy "Authenticated users can update sections" on sections for update to authenticated using (true);
create policy "Authenticated users can delete sections" on sections for delete to authenticated using (true);

-- Instructions (per-instrument cells)
create table instructions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections on delete cascade,
  instrument text not null,
  text text not null default '',
  is_intro boolean not null default false
);
alter table instructions enable row level security;
create policy "Authenticated users can view instructions" on instructions for select to authenticated using (true);
create policy "Authenticated users can insert instructions" on instructions for insert to authenticated with check (true);
create policy "Authenticated users can update instructions" on instructions for update to authenticated using (true);
create policy "Authenticated users can delete instructions" on instructions for delete to authenticated using (true);

-- Session state (drives Live Sync)
create table session_state (
  service_id uuid primary key references services on delete cascade,
  current_song_index int not null default 0,
  current_section_index int not null default 0,
  updated_at timestamptz default now(),
  updated_by text
);
alter table session_state enable row level security;
create policy "Authenticated users can view session_state" on session_state for select to authenticated using (true);
create policy "Authenticated users can insert session_state" on session_state for insert to authenticated with check (true);
create policy "Authenticated users can update session_state" on session_state for update to authenticated using (true);

-- User notes (private)
create table user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  section_id uuid not null references sections on delete cascade,
  instrument text not null,
  note_text text not null,
  updated_at timestamptz default now(),
  unique (user_id, section_id, instrument)
);
alter table user_notes enable row level security;
create policy "Users can view own notes" on user_notes for select using (auth.uid() = user_id);
create policy "Users can insert own notes" on user_notes for insert with check (auth.uid() = user_id);
create policy "Users can update own notes" on user_notes for update using (auth.uid() = user_id);
create policy "Users can delete own notes" on user_notes for delete using (auth.uid() = user_id);

-- Enable realtime for session_state
alter publication supabase_realtime add table session_state;
