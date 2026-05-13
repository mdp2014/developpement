-- ============================================================
-- Migration Groupes (Supabase)
-- ============================================================
-- Objectif:
-- 1) créer les tables de groupes + membres
-- 2) ajouter les colonnes nécessaires dans messages
-- 3) ajouter les index utiles pour limiter la charge

create extension if not exists pgcrypto;

create table if not exists public.chat_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_group_members (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_chat_group_members_user_id
  on public.chat_group_members(user_id);

create index if not exists idx_chat_group_members_group_id
  on public.chat_group_members(group_id);

alter table public.messages
  add column if not exists group_id uuid references public.chat_groups(id) on delete cascade,
  add column if not exists logical_id uuid,
  add column if not exists message_type text;

create index if not exists idx_messages_group_created_at
  on public.messages(group_id, created_at desc);

create index if not exists idx_messages_group_logical
  on public.messages(group_id, logical_id);

create index if not exists idx_messages_group_unread
  on public.messages(id_received, group_id, created_at desc)
  where read_at is null;

create index if not exists idx_messages_direct_sent_received_created
  on public.messages(id_sent, id_received, created_at desc)
  where group_id is null;

create index if not exists idx_messages_direct_received_sent_created
  on public.messages(id_received, id_sent, created_at desc)
  where group_id is null;

-- ------------------------------------------------------------
-- Optionnel (si RLS est activé et que tu veux un modèle ouvert comme le code actuel)
-- ------------------------------------------------------------
-- alter table public.chat_groups enable row level security;
-- alter table public.chat_group_members enable row level security;
--
-- drop policy if exists "chat_groups_all" on public.chat_groups;
-- create policy "chat_groups_all" on public.chat_groups
-- for all using (true) with check (true);
--
-- drop policy if exists "chat_group_members_all" on public.chat_group_members;
-- create policy "chat_group_members_all" on public.chat_group_members
-- for all using (true) with check (true);
