-- 229f (مطبّقة 2026-11-26): النسخة الحيّة من responsibility_set_permissions (استبدال بالـ upsert وحذف غير المُرسَل)
-- + إغلاق الكتابة المباشرة على جداول 229. يحلّ محلّ تعريف الدالة في 229_responsibilities.sql.
create or replace function public.responsibility_set_permissions(p_id uuid, p_rows jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'صلاحيات المسؤوليات يحدّدها المدير العام فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  if not exists (select 1 from public.responsibility_catalog where id = p_id and archived_at is null) then
    raise exception 'المسؤولية غير موجودة أو مؤرشفة';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'الصيغة: مصفوفة صفوف'; end if;
  perform public.tilal_audit_context(p_reason, 'responsibility_set_permissions');
  delete from public.responsibility_permissions
   where responsibility_id = p_id
     and module not in (select x->>'module' from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if not exists (select 1 from public.app_modules where code = r->>'module') then
      raise exception 'وحدة غير معروفة: %', r->>'module';
    end if;
    if r->>'module' in ('permission_grants', 'organization') then
      raise exception 'الوحدة % لا تُمنح عبر مسؤولية', r->>'module';
    end if;
    insert into public.responsibility_permissions (responsibility_id, module, actions, scope)
    values (p_id, r->>'module', array(select jsonb_array_elements_text(r->'actions')), coalesce(r->>'scope', 'own'))
    on conflict (responsibility_id, module) do update
      set actions = excluded.actions, scope = excluded.scope, updated_by = auth.uid(), updated_at = now();
  end loop;
end $$;
grant execute on function public.responsibility_set_permissions(uuid, jsonb, text) to authenticated;

revoke insert, update, delete, truncate, references, trigger
    on public.responsibility_catalog, public.responsibility_permissions, public.responsibility_kpis,
       public.responsibility_assignments from authenticated;
revoke all on public.responsibility_catalog, public.responsibility_permissions, public.responsibility_kpis,
              public.responsibility_assignments from anon;
