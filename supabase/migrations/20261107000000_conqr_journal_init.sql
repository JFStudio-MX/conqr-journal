-- =====================================================================
-- CONQR Journal · esquema inicial
-- Se ejecuta una vez en el SQL Editor de Supabase (o con `supabase db push`).
-- Es re-ejecutable: usa IF NOT EXISTS / DROP ... IF EXISTS.
--
-- Modelo: una tabla de registros versionados por usuario. Cada colección del
-- diario (entries, projects, goals, attendance, settings, attachments…) guarda
-- sus registros como JSON. La autorización es 100 % del lado del servidor (RLS):
-- cada persona solo puede leer y escribir sus propias filas.
-- =====================================================================

create sequence if not exists public.records_seq;

create table if not exists public.records (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection        text        not null,
  id                text        not null,
  version           integer     not null default 1,
  data              jsonb       not null default '{}'::jsonb,
  deleted           boolean     not null default false,
  mutation_id       uuid        not null,
  client_updated_at timestamptz,
  server_created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  server_seq        bigint      not null default nextval('public.records_seq'),
  primary key (user_id, collection, id),
  constraint records_collection_chk check (collection in (
    'entries','brands','projects','goals','reflections','reviews','attendance','settings','attachments',
    'meetings','transcripts','actions','changes'
  )),
  constraint records_id_chk check (id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  constraint records_data_obj_chk check (jsonb_typeof(data) = 'object'),
  constraint records_data_size_chk check (pg_column_size(data) <= 524288)
);

create index if not exists records_user_seq_idx on public.records (user_id, server_seq);

comment on table public.records is 'CONQR Journal: registros versionados por usuario (RLS: solo el dueño).';

-- ---------------------------------------------------------------------
-- Integridad: el servidor es quien asigna versión, fechas y secuencia.
-- Aplica también a escrituras directas, no solo a push_changes.
-- ---------------------------------------------------------------------
create or replace function public.records_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.server_created_at := now();
  else
    new.user_id := old.user_id;
    new.collection := old.collection;
    new.id := old.id;
    new.version := old.version + 1;
    new.server_created_at := old.server_created_at;
  end if;
  new.server_updated_at := now();
  new.server_seq := nextval('public.records_seq');
  return new;
end;
$$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write
  before insert or update on public.records
  for each row execute function public.records_before_write();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.records enable row level security;

revoke all on public.records from anon, authenticated;
grant select, insert, update on public.records to authenticated;
grant usage on sequence public.records_seq to authenticated;

drop policy if exists records_select_own on public.records;
create policy records_select_own on public.records
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists records_insert_own on public.records;
create policy records_insert_own on public.records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists records_update_own on public.records;
create policy records_update_own on public.records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Sin política DELETE: los borrados son lápidas (deleted = true, data = {})
-- para que se propaguen a todos los dispositivos y nada reaparezca.

-- ---------------------------------------------------------------------
-- push_changes: aplica un lote de cambios con control de versiones.
--   · base_version = versión sobre la que se hizo el cambio.
--   · mutation_id  = id único del cambio (reintentos idempotentes).
-- Devuelve por cada cambio: status 'applied' o 'conflict' y la fila actual.
-- SECURITY INVOKER: corre con los permisos (y el RLS) de quien llama.
-- ---------------------------------------------------------------------
create or replace function public.push_changes(changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  ch   jsonb;
  cur  public.records%rowtype;
  res  jsonb := '[]'::jsonb;
  base integer;
  mid  uuid;
  col  text;
  rid  text;
begin
  if uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) <> 'array' then
    raise exception 'changes debe ser un arreglo' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) > 100 then
    raise exception 'Demasiados cambios en un lote (máx. 100)' using errcode = '54000';
  end if;

  for ch in select value from jsonb_array_elements(changes) loop
    col  := ch->>'collection';
    rid  := ch->>'id';
    base := coalesce((ch->>'base_version')::integer, 0);
    mid  := (ch->>'mutation_id')::uuid;
    if col is null or rid is null or mid is null then
      raise exception 'Cambio incompleto' using errcode = '22023';
    end if;

    select * into cur from public.records r
     where r.user_id = uid and r.collection = col and r.id = rid
     for update;

    if not found then
      insert into public.records (user_id, collection, id, data, deleted, mutation_id, client_updated_at)
      values (uid, col, rid,
              case when coalesce((ch->>'deleted')::boolean, false) then '{}'::jsonb else coalesce(ch->'data', '{}'::jsonb) end,
              coalesce((ch->>'deleted')::boolean, false), mid, (ch->>'client_updated_at')::timestamptz)
      returning * into cur;
      res := res || jsonb_build_array(jsonb_build_object('collection', col, 'id', rid, 'status', 'applied', 'row', to_jsonb(cur) - 'user_id'));
    elsif cur.mutation_id = mid then
      -- Reintento de un cambio ya aplicado: no se duplica.
      res := res || jsonb_build_array(jsonb_build_object('collection', col, 'id', rid, 'status', 'applied', 'row', to_jsonb(cur) - 'user_id'));
    elsif cur.version = base then
      update public.records r
         set data = case when coalesce((ch->>'deleted')::boolean, false) then '{}'::jsonb else coalesce(ch->'data', '{}'::jsonb) end,
             deleted = coalesce((ch->>'deleted')::boolean, false),
             mutation_id = mid,
             client_updated_at = (ch->>'client_updated_at')::timestamptz
       where r.user_id = uid and r.collection = col and r.id = rid
      returning * into cur;
      res := res || jsonb_build_array(jsonb_build_object('collection', col, 'id', rid, 'status', 'applied', 'row', to_jsonb(cur) - 'user_id'));
    else
      -- Otro dispositivo cambió el registro: no se sobrescribe; se devuelve la versión actual.
      res := res || jsonb_build_array(jsonb_build_object('collection', col, 'id', rid, 'status', 'conflict', 'row', to_jsonb(cur) - 'user_id'));
    end if;
  end loop;

  return res;
end;
$$;

revoke all on function public.push_changes(jsonb) from public;
revoke all on function public.push_changes(jsonb) from anon;
grant execute on function public.push_changes(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Almacenamiento privado de capturas: bucket NO público.
-- Ruta de cada archivo: <user_id>/<attachment_id>.<ext>
-- Solo el dueño de la carpeta puede leer, subir, reemplazar o borrar.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 2097152, array['image/webp','image/jpeg','image/png','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists conqr_attachments_select_own on storage.objects;
create policy conqr_attachments_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists conqr_attachments_insert_own on storage.objects;
create policy conqr_attachments_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists conqr_attachments_update_own on storage.objects;
create policy conqr_attachments_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists conqr_attachments_delete_own on storage.objects;
create policy conqr_attachments_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
