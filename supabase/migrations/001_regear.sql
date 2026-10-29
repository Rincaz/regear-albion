-- Regear Albion: datos compartidos por gremio.
-- Ejecutar completo en Supabase → SQL Editor (o: supabase db push).
-- Roles: admin (todo + cambiar roles), editor (edita builds, guías, stock, precios), viewer (solo lectura).

create extension if not exists pgcrypto;

-- ---------- Tablas ----------
create table if not exists public.guilds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.guild_members (
  guild_id     uuid not null references public.guilds (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  display_name text not null default '' check (char_length(display_name) <= 40),
  joined_at    timestamptz not null default now(),
  primary key (guild_id, user_id)
);
create index if not exists guild_members_user_idx on public.guild_members (user_id);

-- Documentos JSON del gremio (builds, guías, precios, estado del reequip y registro del banco ya aplicado).
create table if not exists public.guild_docs (
  guild_id   uuid not null references public.guilds (id) on delete cascade,
  kind       text not null check (kind in ('builds', 'guides', 'prices', 'taken', 'checked', 'logSeen')),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 2000000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (guild_id, kind)
);

-- Stock por item y lugar ('' = sin lugar). Solo se modifica con stock_apply (sumas atómicas).
create table if not exists public.stock (
  guild_id   uuid not null references public.guilds (id) on delete cascade,
  item_id    text not null check (item_id ~ '^T[0-9]_[A-Za-z0-9_]+(@[0-9])?$'),
  place      text not null default '' check (char_length(place) <= 40),
  qty        integer not null check (qty between 1 and 99999),
  updated_at timestamptz not null default now(),
  primary key (guild_id, item_id, place)
);

-- Movimientos del cofre (quién ingresó o sacó cada item).
create table if not exists public.movements (
  id         bigint generated always as identity primary key,
  guild_id   uuid not null references public.guilds (id) on delete cascade,
  ts         text not null check (char_length(ts) <= 19),
  player     text not null check (char_length(player) <= 40),
  item_id    text not null check (char_length(item_id) <= 80),
  qty        integer not null check (qty <> 0 and qty between -99999 and 99999),
  place      text not null default '' check (char_length(place) <= 40),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists movements_guild_ts_idx on public.movements (guild_id, ts desc);

-- ---------- Funciones de permisos (security definer para no recursar en RLS) ----------
create or replace function public.member_role(g uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select role from public.guild_members where guild_id = g and user_id = auth.uid()
$$;
create or replace function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.member_role(g) is not null
$$;
create or replace function public.can_edit(g uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public.member_role(g) in ('admin', 'editor'), false)
$$;
create or replace function public.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public.member_role(g) = 'admin', false)
$$;

-- ---------- Permisos de tabla (no se depende de la opción «exponer tablas nuevas»; RLS filtra las filas) ----------
grant usage on schema public to authenticated;
grant select on public.guilds, public.guild_members, public.guild_docs, public.stock, public.movements to authenticated;
grant update, delete on public.guilds to authenticated;
grant update, delete on public.guild_members to authenticated;
grant insert, update on public.guild_docs to authenticated;
grant insert on public.movements to authenticated;
revoke all on public.guilds, public.guild_members, public.guild_docs, public.stock, public.movements from anon;

-- ---------- RLS ----------
alter table public.guilds        enable row level security;
alter table public.guild_members enable row level security;
alter table public.guild_docs    enable row level security;
alter table public.stock         enable row level security;
alter table public.movements     enable row level security;

drop policy if exists guilds_select on public.guilds;
create policy guilds_select on public.guilds for select to authenticated using (public.is_member(id));
drop policy if exists guilds_update on public.guilds;
create policy guilds_update on public.guilds for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));
drop policy if exists guilds_delete on public.guilds;
create policy guilds_delete on public.guilds for delete to authenticated using (public.is_admin(id));

drop policy if exists members_select on public.guild_members;
create policy members_select on public.guild_members for select to authenticated using (public.is_member(guild_id));
-- Un admin cambia el rol de otros; nadie cambia su propio rol.
drop policy if exists members_update on public.guild_members;
create policy members_update on public.guild_members for update to authenticated
  using (public.is_admin(guild_id) and user_id <> auth.uid()) with check (public.is_admin(guild_id) and user_id <> auth.uid());
-- Cada uno puede salir del gremio; un admin puede expulsar.
drop policy if exists members_delete on public.guild_members;
create policy members_delete on public.guild_members for delete to authenticated
  using (user_id = auth.uid() or public.is_admin(guild_id));

drop policy if exists docs_select on public.guild_docs;
create policy docs_select on public.guild_docs for select to authenticated using (public.is_member(guild_id));
drop policy if exists docs_insert on public.guild_docs;
create policy docs_insert on public.guild_docs for insert to authenticated with check (public.can_edit(guild_id));
drop policy if exists docs_update on public.guild_docs;
create policy docs_update on public.guild_docs for update to authenticated using (public.can_edit(guild_id)) with check (public.can_edit(guild_id));

drop policy if exists stock_select on public.stock;
create policy stock_select on public.stock for select to authenticated using (public.is_member(guild_id));

drop policy if exists moves_select on public.movements;
create policy moves_select on public.movements for select to authenticated using (public.is_member(guild_id));
drop policy if exists moves_insert on public.movements;
create policy moves_insert on public.movements for insert to authenticated with check (public.can_edit(guild_id));

-- ---------- RPC ----------
create or replace function public.create_guild(p_name text, p_display text default '')
returns public.guilds language plpgsql security definer set search_path = public, extensions as $$
declare g public.guilds;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  insert into public.guilds (name, created_by) values (left(trim(p_name), 60), auth.uid()) returning * into g;
  insert into public.guild_members (guild_id, user_id, role, display_name) values (g.id, auth.uid(), 'admin', left(coalesce(trim(p_display), ''), 40));
  return g;
end $$;

create or replace function public.join_guild(p_code text, p_display text default '')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select id into gid from public.guilds where invite_code = lower(trim(p_code));
  if gid is null then raise exception 'Código de invitación no válido'; end if;
  insert into public.guild_members (guild_id, user_id, role, display_name)
  values (gid, auth.uid(), 'viewer', left(coalesce(trim(p_display), ''), 40))
  on conflict (guild_id, user_id) do nothing;
  return gid;
end $$;

create or replace function public.rotate_invite(p_guild uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if not public.is_admin(p_guild) then raise exception 'Solo un admin puede cambiar el código'; end if;
  update public.guilds set invite_code = encode(gen_random_bytes(6), 'hex') where id = p_guild returning invite_code into c;
  return c;
end $$;

-- Aplica sumas/restas al stock en una sola transacción: [{"item":"T8_MAIN_MACE","place":"","delta":-2}, ...]
-- Nunca baja de 0 (la fila se borra) ni sube de 99999. Devuelve la cantidad final de cada celda tocada.
create or replace function public.stock_apply(p_guild uuid, p_changes jsonb)
returns table (item_id text, place text, qty integer)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare ch jsonb; v_item text; v_place text; v_delta integer; v_new integer;
begin
  if not public.can_edit(p_guild) then raise exception 'Sin permiso para editar el stock'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 5000 then raise exception 'Cambios no válidos'; end if;
  for ch in select * from jsonb_array_elements(p_changes) loop
    v_item := ch ->> 'item';
    v_place := left(coalesce(ch ->> 'place', ''), 40);
    v_delta := (ch ->> 'delta')::integer;
    if v_item !~ '^T[0-9]_[A-Za-z0-9_]+(@[0-9])?$' or v_delta is null or v_delta = 0 then continue; end if;
    select s.qty into v_new from public.stock s where s.guild_id = p_guild and s.item_id = v_item and s.place = v_place for update;
    v_new := least(99999, greatest(0, coalesce(v_new, 0) + v_delta));
    if v_new = 0 then
      delete from public.stock s where s.guild_id = p_guild and s.item_id = v_item and s.place = v_place;
    else
      insert into public.stock as s (guild_id, item_id, place, qty, updated_at) values (p_guild, v_item, v_place, v_new, now())
      on conflict (guild_id, item_id, place) do update set qty = excluded.qty, updated_at = now();
    end if;
    item_id := v_item; place := v_place; qty := v_new;
    return next;
  end loop;
end $$;

revoke all on function public.create_guild(text, text), public.join_guild(text, text), public.rotate_invite(uuid), public.stock_apply(uuid, jsonb) from public, anon;
grant execute on function public.create_guild(text, text), public.join_guild(text, text), public.rotate_invite(uuid), public.stock_apply(uuid, jsonb) to authenticated;

-- ---------- Tiempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.guild_docs, public.stock, public.movements, public.guild_members;
exception when duplicate_object then null; end $$;
