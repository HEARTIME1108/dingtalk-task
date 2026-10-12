-- ============================================================
-- 迁移 v2: 任务编辑/附件/评论/标签/子任务/统计导出
-- 在 Supabase Dashboard -> SQL Editor 中执行
-- ============================================================

-- ============================================================
-- 1. tasks 表新增列(子任务 parent_id)
-- ============================================================
alter table public.tasks add column if not exists parent_id uuid references public.tasks(id) on delete cascade;
create index if not exists idx_tasks_parent on public.tasks(parent_id);

-- ============================================================
-- 2. 任务附件表
-- ============================================================
create table if not exists public.task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks(id) on delete cascade,
  uploader_id uuid references public.users(id) on delete set null,
  file_name   varchar(255) not null,
  file_url    text not null,
  file_size   integer default 0,
  file_type   varchar(50) default '',
  created_at  timestamptz default now() not null
);
create index if not exists idx_attachments_task on public.task_attachments(task_id);
alter table public.task_attachments enable row level security;
create policy "attachments_select_member" on public.task_attachments
  for select using (public.is_task_member(task_id));
create policy "attachments_insert_member" on public.task_attachments
  for insert with check (public.is_task_member(task_id));
create policy "attachments_delete_member" on public.task_attachments
  for delete using (public.is_task_member(task_id));

-- ============================================================
-- 3. 任务评论表
-- ============================================================
create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  content     text not null,
  created_at  timestamptz default now() not null
);
create index if not exists idx_comments_task on public.task_comments(task_id);
alter table public.task_comments enable row level security;
create policy "comments_select_member" on public.task_comments
  for select using (public.is_task_member(task_id));
create policy "comments_insert_member" on public.task_comments
  for insert with check (public.is_task_member(task_id));
create policy "comments_delete_self" on public.task_comments
  for delete using (user_id = auth.uid());

-- ============================================================
-- 4. 标签表
-- ============================================================
create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        varchar(50) not null unique,
  color       varchar(20) default '#1989fa',
  created_at  timestamptz default now() not null
);

-- 任务-标签关联(多对多)
create table if not exists public.task_tags (
  task_id     uuid references public.tasks(id) on delete cascade,
  tag_id      uuid references public.tags(id) on delete cascade,
  created_at  timestamptz default now() not null,
  primary key (task_id, tag_id)
);
create index if not exists idx_task_tags_task on public.task_tags(task_id);
create index if not exists idx_task_tags_tag on public.task_tags(tag_id);
alter table public.task_tags enable row level security;
create policy "task_tags_select" on public.task_tags
  for select using (public.is_task_member(task_id));
create policy "task_tags_insert_member" on public.task_tags
  for insert with check (public.is_task_member(task_id));
create policy "task_tags_delete_member" on public.task_tags
  for delete using (public.is_task_member(task_id));
alter table public.tags enable row level security;
create policy "tags_read_all" on public.tags for select using (true);

-- ============================================================
-- 5. 插入默认标签
-- ============================================================
insert into public.tags (name, color) values
  ('巡检', '#1989fa'),
  ('维修', '#ee0a24'),
  ('培训', '#07c160'),
  ('会议', '#ff976a'),
  ('其他', '#969799')
on conflict (name) do nothing;
