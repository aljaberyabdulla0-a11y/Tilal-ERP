-- 228d (مطبّقة 2026-11-26): اكتشفه 228b/T10 — إنهاء وظيفة إضافية مُنحت صلاحيات بانتهاء لاحق كان يخالف
-- employee_positions_perm_exp_chk. الصلاحيات لا تعيش بعد الوظيفة: الحارس يقصّ permissions_expire_on إلى end_date
-- في كل مسارات الإنهاء (يدوي، انتهاء تلقائي، انتهاء الخدمة، تغيير المنصب).
create or replace function public.employee_positions_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.department_id is null then
    select p.department_id into new.department_id from public.positions p where p.id = new.position_id;
  end if;
  if new.status = 'ended' and new.end_date is null then
    new.end_date := public.baghdad_today();
  end if;
  if new.end_date is not null and new.permissions_expire_on is not null and new.permissions_expire_on > new.end_date then
    new.permissions_expire_on := new.end_date;
  end if;
  if new.status in ('active', 'pending_approval') and exists (
       select 1 from public.employee_positions o
        where o.employee_id = new.employee_id and o.position_id = new.position_id and o.id <> new.id
          and o.status in ('active', 'pending_approval')
          and daterange(o.start_date, o.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'الموظف معيَّن على هذا المنصب في فترة متداخلة';
  end if;
  if tg_op = 'INSERT' and new.status = 'active' and exists (
       select 1 from public.positions p where p.id = new.position_id and p.status <> 'نشط') then
    raise exception 'المنصب مؤرشف';
  end if;
  return new;
end $$;
