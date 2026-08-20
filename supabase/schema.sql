-- Honniscoins backend. Legges til i det EKSISTERENDE Handleliste-Supabase-prosjektet.
-- Kjøres én gang i SQL editor.

create table if not exists public.honniscoins_rooms (
  room_hash text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Tabellen nås kun via Edge Function (som i Handleliste), ikke direkte fra klient.
alter table public.honniscoins_rooms enable row level security;

-- Edge Function "honniscoins" (speiler Handleliste sin funksjon):
--   POST { room, action:"load" }        -> { data: <blob|null>, updated_at }
--   POST { room, action:"save", data }  -> { ok: true }
-- Funksjonen hasher `room` (SHA-256) til room_hash for upsert/select mot tabellen over.
-- CORS: tillat POST + OPTIONS (personlig familie-app).
-- Frontend peker på funksjonen via EDGE_FUNCTION_URL i index.html (settes til slutt).
