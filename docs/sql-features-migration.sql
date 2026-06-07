-- ============================================================
-- Migration fonctionnalités messagerie
-- Exécuter dans Supabase SQL Editor
-- ============================================================

-- Statut & avatar utilisateurs
alter table public.users
  add column if not exists status_type text default 'available'
    check (status_type in ('available', 'busy', 'away', 'custom')),
  add column if not exists status_text text,
  add column if not exists avatar_url text;

-- Réponses & réactions messages
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null,
  add column if not exists reactions jsonb default '{}'::jsonb;

create index if not exists idx_messages_reply_to on public.messages(reply_to_id);

-- Groupes enrichis
alter table public.chat_groups
  add column if not exists avatar_url text,
  add column if not exists description text,
  add column if not exists pinned_message_id uuid references public.messages(id) on delete set null;

-- Abonnements Web Push (notifications app fermée)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

-- Appels entrants persistés (notification push quand app fermée)
create table if not exists public.incoming_call_signals (
  id uuid primary key default gen_random_uuid(),
  callee_id uuid not null references public.users(id) on delete cascade,
  caller_id uuid not null references public.users(id) on delete cascade,
  call_id text not null,
  offer jsonb,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index if not exists idx_incoming_calls_callee
  on public.incoming_call_signals(callee_id, created_at desc)
  where handled_at is null;
