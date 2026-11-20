-- Synchronisation des chantiers entre appareils.
-- À coller une fois dans Supabase : SQL Editor > New query > Run.
-- Chaque compte connecté de l'équipe voit et modifie les mêmes chantiers.
-- Les inscriptions publiques doivent être désactivées : seuls les comptes créés dans le tableau
-- de bord (Authentication > Users > Add user) peuvent se connecter.

create table if not exists public.chantiers (
  id          text primary key,
  data        jsonb,
  saved_at    timestamptz not null default now(),
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Horodatage serveur : sert à ne relire que ce qui a changé depuis la dernière synchro.
create or replace function public.chantiers_horodatage() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists chantiers_horodatage on public.chantiers;
create trigger chantiers_horodatage before insert or update on public.chantiers
for each row execute function public.chantiers_horodatage();

create index if not exists chantiers_updated_at on public.chantiers (updated_at);

-- Sécurité : rien n'est accessible sans être connecté.
alter table public.chantiers enable row level security;

drop policy if exists "equipe lecture" on public.chantiers;
drop policy if exists "equipe ajout" on public.chantiers;
drop policy if exists "equipe modification" on public.chantiers;
create policy "equipe lecture" on public.chantiers for select to authenticated using (true);
create policy "equipe ajout" on public.chantiers for insert to authenticated with check (true);
create policy "equipe modification" on public.chantiers for update to authenticated using (true) with check (true);
-- Pas de suppression réelle : une suppression est enregistrée comme deleted = true,
-- pour être transmise aux autres appareils.

revoke all on public.chantiers from anon;
grant select, insert, update on public.chantiers to authenticated;
