-- ============================================================
-- 通知功能增量 SQL - 在已执行 schema.sql 之后执行
-- ============================================================

-- ============================================================
-- 6. 通知记录表(去重 + 防重发)
-- ============================================================
create table if not exists public.task_notifications (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references public.tasks(id) on delete cascade,
  recipient_id uuid references public.users(id) on delete cascade,
  -- 通知类型:assign 派发 / approve 通过 / reject 驳回
  --          complete 完成 / due_remind 到期提醒 / overdue 超期
  type         varchar(30) not null,
  sent_at      timestamptz default now() not null,
  unique(task_id, recipient_id, type, date_trunc('day', sent_at))
);

create index if not exists idx_task_notifications_task on public.task_notifications(task_id);
create index if not exists idx_task_notifications_recipient on public.task_notifications(recipient_id);

alter table public.task_notifications enable row level security;

drop policy if exists "notifications_select" on public.task_notifications;
drop policy if exists "notifications_insert_member" on public.task_notifications;
create policy "notifications_select" on public.task_notifications
  for select using (public.is_task_member(task_id));
create policy "notifications_insert_member" on public.task_notifications
  for insert with check (public.is_task_member(task_id));

-- ============================================================
-- 辅助函数:获取某任务所有相关人(创建者+负责人+审批人+协作者)
-- ============================================================
create or replace function public.task_participants(_task_id uuid)
returns table (user_id uuid) language sql security definer as $$
  select creator_id from public.tasks where id = _task_id
  union
  select assignee_id from public.tasks where id = _task_id
  union
  select reviewer_id from public.tasks where id = _task_id
  union
  select user_id from public.task_assignees where task_id = _task_id;
$$;
