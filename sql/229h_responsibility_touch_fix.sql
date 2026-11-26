-- 229h (مطبّقة 2026-11-26): اكتشفه 229b/R3 — responsibility_touch مشتركة بين المكتبة والتكليف، وPL/pgSQL
-- لا يختصر AND فكان new.status يُقيَّم على responsibility_catalog (لا عمود status) ⇒ أي تعديل للمكتبة يفشل.
create or replace function public.responsibility_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name = 'responsibility_assignments' then
    if new.status = 'ended' and new.end_date is null then
      new.end_date := greatest(new.start_date, public.baghdad_today());
    end if;
  end if;
  return new;
end $$;
