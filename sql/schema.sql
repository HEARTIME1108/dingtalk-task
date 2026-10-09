-- ============================================================
-- 钉钉任务管理系统 - Supabase 数据库 Schema
-- 在 Supabase Dashboard -> SQL Editor 中执行
-- ============================================================

-- 扩展(确保 uuid 生成可用)
create extension if not exists pgcrypto;

-- ============================================================
-- 1. 用户表
--    id 共享 auth.users 主键,这样 RLS 可直接用 auth.uid()
-- ============================================================
create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  dingtalk_user_id varchar(64) unique not null,   -- 钉钉 userid
  union_id        varchar(64),                    -- 钉钉 unionid(可选)
  name           varchar(64) not null,
  avatar_url     text,
  role           varchar(20) default 'member' not null, -- admin / manager / member
  created_at     timestamptz default now() not null
);

-- ============================================================
-- 2. 任务表
-- ============================================================
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        varchar(200) not null,
  description  text,
  status       varchar(20) default 'draft' not null,
    -- draft 草稿 / pending_review 待审 / approved 已通过 / rejected 已驳回
    -- in_progress 进行中 / done 已完成 / cancelled 已取消
  priority     varchar(10) default 'medium' not null, -- low/medium/high/urgent
  creator_id   uuid references public.users(id) on delete set null,
  assignee_id  uuid references public.users(id) on delete set null,  -- 主负责人
  reviewer_id  uuid references public.users(id) on delete set null,  -- 审批人
  due_date     date,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);

-- 自动更新 updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. 任务协作者(多人协作)
-- ============================================================
create table if not exists public.task_assignees (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid references public.tasks(id) on delete cascade,
  user_id   uuid references public.users(id) on delete cascade,
  role      varchar(20) default 'assignee' not null, -- assignee/reviewer/watcher
  created_at timestamptz default now() not null,
  unique(task_id, user_id)
);

-- ============================================================
-- 4. 任务流转记录(审批 / 状态变更)
-- ============================================================
create table if not exists public.task_flows (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks(id) on delete cascade,
  operator_id uuid references public.users(id) on delete set null,
  from_status varchar(20),
  to_status   varchar(20) not null,
  comment     text,
  created_at  timestamptz default now() not null
);

-- ============================================================
-- 5. 任务操作日志
-- ============================================================
create table if not exists public.task_logs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks(id) on delete cascade,
  operator_id uuid references public.users(id) on delete set null,
  action      varchar(50) not null, -- create/update/assign/comment
  detail      jsonb,
  created_at  timestamptz default now() not null
);

-- ============================================================
-- 索引
-- ============================================================
create index if not exists idx_tasks_creator  on public.tasks(creator_id);
create index if not exists idx_tasks_assignee on public.tasks(assignee_id);
create index if not exists idx_tasks_status   on public.tasks(status);
create index if not exists idx_task_assignees_task on public.task_assignees(task_id);
create index if not exists idx_task_assignees_user on public.task_assignees(user_id);
create index if not exists idx_task_flows_task on public.task_flows(task_id);
create index if not exists idx_task_logs_task on public.task_logs(task_id);

-- ============================================================
-- 启用 RLS
-- ============================================================
alter table public.users           enable row level security;
alter table public.tasks           enable row level security;
alter table public.task_assignees  enable row level security;
alter table public.task_flows      enable row level security;
alter table public.task_logs       enable row level security;

-- ============================================================
-- 辅助函数:当前用户是否为某任务的相关成员
-- ============================================================
create or replace function public.is_task_member(_task_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.tasks t
    left join public.task_assignees ta on ta.task_id = t.id
    where t.id = _task_id
      and (
        t.creator_id  = auth.uid()
        or t.assignee_id = auth.uid()
        or t.reviewer_id = auth.uid()
        or ta.user_id    = auth.uid()
      )
  );
$$;

-- ============================================================
-- users 策略
-- ============================================================
drop policy if exists "users_read_all"   on public.users;
drop policy if exists "users_insert_self" on public.users;
drop policy if exists "users_update_self" on public.users;
create policy "users_read_all"   on public.users for select using (true);
create policy "users_insert_self" on public.users for insert with check (id = auth.uid());
create policy "users_update_self" on public.users for update using (id = auth.uid()) with check (id = auth.uid());

-- ============================================================
-- tasks 策略
-- ============================================================
drop policy if exists "tasks_select_member" on public.tasks;
drop policy if exists "tasks_insert_creator" on public.tasks;
drop policy if exists "tasks_update_creator" on public.tasks;
drop policy if exists "tasks_delete_creator" on public.tasks;
create policy "tasks_select_member" on public.tasks
  for select using (public.is_task_member(id));
create policy "tasks_insert_creator" on public.tasks
  for insert with check (creator_id = auth.uid());
create policy "tasks_update_creator" on public.tasks
  for update using (creator_id = auth.uid());
create policy "tasks_delete_creator" on public.tasks
  for delete using (creator_id = auth.uid());

-- ============================================================
-- task_assignees 策略
-- ============================================================
drop policy if exists "assignees_select" on public.task_assignees;
drop policy if exists "assignees_modify" on public.task_assignees;
create policy "assignees_select" on public.task_assignees
  for select using (public.is_task_member(task_id));
create policy "assignees_modify" on public.task_assignees
  for all using (
    exists (select 1 from public.tasks t where t.id = task_id and t.creator_id = auth.uid())
  );

-- ============================================================
-- task_flows 策略
-- ============================================================
drop policy if exists "flows_select" on public.task_flows;
drop policy if exists "flows_insert" on public.task_flows;
create policy "flows_select" on public.task_flows
  for select using (public.is_task_member(task_id));
create policy "flows_insert" on public.task_flows
  for insert with check (public.is_task_member(task_id));

-- ============================================================
-- task_logs 策略
-- ============================================================
drop policy if exists "logs_select" on public.task_logs;
drop policy if exists "logs_insert" on public.task_logs;
create policy "logs_select" on public.task_logs
  for select using (public.is_task_member(task_id));
create policy "logs_insert" on public.task_logs
  for insert with check (public.is_task_member(task_id));

-- ============================================================
-- 触发器:新用户在 auth.users 注册时自动写入 public.users
-- (后端用 service_role 创建 auth 用户后,这里兜底)
-- ============================================================
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, name, avatar_url, dingtalk_user_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', '新用户'),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'dingtalk_user_id', new.raw_user_meta_data->>'sub')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
