-- ══════════════════════════════════════════════════════════════════════
-- FlowMint — Esquema de licencias + RLS cerrada
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.licenses (
  license_key   text primary key,
  email         text,
  status        text not null default 'active',   -- 'active' | 'revoked'
  max_devices   int  not null default 2,
  devices       jsonb not null default '[]'::jsonb,
  offer_code    text,                              -- código de oferta/producto de Hotmart
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Log de auditoría (opcional pero recomendado): cada intento de activación,
-- exitoso o rechazado, queda registrado para poder investigar disputas.
create table if not exists public.license_activation_log (
  id           bigserial primary key,
  license_key  text not null,
  device_id    text not null,
  result       text not null,   -- 'granted' | 'already_registered' | 'limit_reached' | 'invalid_license' | 'error'
  ip_address   text,
  user_agent   text,
  created_at   timestamptz not null default now()
);

-- Trigger para mantener updated_at al día automáticamente.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_licenses_updated_at on public.licenses;
create trigger trg_licenses_updated_at
  before update on public.licenses
  for each row execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- RLS: CERRADA para anon/authenticated. Solo las Edge Functions
-- (que usan la service_role key, la cual SIEMPRE ignora RLS) pueden
-- leer o escribir esta tabla. Esto es lo que hace imposible que un
-- usuario manipule el array `devices` desde DevTools/consola.
-- ══════════════════════════════════════════════════════════════════════
alter table public.licenses enable row level security;
alter table public.license_activation_log enable row level security;

-- IMPORTANTE: si en tu proyecto ya existían políticas permisivas de una
-- implementación anterior (la que llamaba a /rest/v1/licenses directo
-- desde el navegador), bórralas. Ejemplo genérico (ajusta el nombre si
-- el tuyo es distinto — puedes verlas en Database → Policies):
--
--   drop policy if exists "Enable read access for all users" on public.licenses;
--   drop policy if exists "Enable insert for anon" on public.licenses;
--   drop policy if exists "Enable update for anon" on public.licenses;
--
-- No se crea NINGUNA policy nueva a propósito: con RLS activado y cero
-- policies, el acceso queda denegado por defecto para anon/authenticated.
