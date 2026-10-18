-- ============================================================
-- migration_v3: 职务标签 + 每日提醒配置
-- 在 Supabase 的 SQL Editor 里整段执行,可重复执行
-- ============================================================

-- 1. 给用户加「职务」字段
--    department_head 部门主任 / team_a_lead 运行一值值长
--    team_b_lead   运行二值值长 / team_a_member 运行一值员工
--    team_b_member 运行二值员工 / member 员工
alter table public.users add column if not exists duty varchar(20) default 'member';
comment on column public.users.duty is '职务:department_head 部门主任 / team_a_lead 运行一值值长 / team_b_lead 运行二值值长 / team_a_member 运行一值员工 / team_b_member 运行二值员工 / member 员工';

-- 2. 每日未完成工作提醒:每人一条配置
create table if not exists public.daily_digest_settings (
  user_id        uuid primary key references public.users(id) on delete cascade,
  enabled        boolean default false not null,
  types          text[]  default '{}'::text[] not null, -- 关注分类:department / team_a / team_b
  hour           int     default 8 not null,            -- 每天几点发(北京时间 0-23 整点)
  last_sent_slot varchar(20),                           -- 已发送的时段,用于防止重复发送
  updated_at     timestamptz default now() not null
);
alter table public.daily_digest_settings enable row level security;

-- 后端用 service_role 绕过 RLS,这条策略只是保险(允许用户读写自己那一条)
drop policy if exists "自己读写自己的提醒配置" on public.daily_digest_settings;
create policy "自己读写自己的提醒配置" on public.daily_digest_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. 参考:初始化职务(按实际情况改 id)
-- update public.users set duty = 'department_head' where name = 'XXX';
-- update public.users set duty = 'team_a_lead'      where name = 'XXX';
-- update public.users set duty = 'team_b_lead'      where name = 'XXX';
