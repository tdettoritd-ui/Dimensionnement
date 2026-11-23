-- Ajout de la synchronisation des plans (si schema.sql a été exécuté avant cet ajout).
-- À coller dans Supabase : SQL Editor > New query > Run.
insert into storage.buckets (id, name, public) values ('plans', 'plans', false)
on conflict (id) do nothing;

drop policy if exists "equipe plans lecture" on storage.objects;
drop policy if exists "equipe plans ajout" on storage.objects;
drop policy if exists "equipe plans modification" on storage.objects;
create policy "equipe plans lecture" on storage.objects for select to authenticated using (bucket_id = 'plans');
create policy "equipe plans ajout" on storage.objects for insert to authenticated with check (bucket_id = 'plans');
create policy "equipe plans modification" on storage.objects for update to authenticated using (bucket_id = 'plans') with check (bucket_id = 'plans');
