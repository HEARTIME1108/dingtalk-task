# 待开发事项

> 记录还没做完的需求,做完一项删一项。

---

## 1. 接入钉钉「待办」 —— 暂缓,等权限开通

**状态**:等用户在钉钉开放平台开通「待办应用中待办写权限」(`Todo.Todo.Write`)并**发布新版本**后开工。

**接口**

| 动作 | 接口 |
|------|------|
| 创建待办 | `POST https://api.dingtalk.com/v1.0/todo/users/{unionId}/tasks` |
| 更新状态 | `PUT  https://api.dingtalk.com/v1.0/todo/users/{unionId}/tasks/{taskId}` |

- 请求头用现有的应用级 token(`x-acs-dingtalk-access-token`),`{unionId}` 取 `users.union_id`
- 2024-02-01 起该创建接口**只支持工作待办**,`detailUrl` 变**必填** → 传任务详情页链接
- 权限没开通前调用会报权限错误,代码写完也跑不通,所以先等权限

**已确认的方案**

- 任务派发 → 给 **负责人 + 协作者** 各建一条待办
- 提交审核 → 给 **审核人** 建一条待办(不在派发时建,避免审核人提前挂着待办)
- 任务完成 / 关闭 → 把相关待办**全部标记为已完成**

**开工前要做的事**

- [ ] 用户开通并发布「待办写权限」
- [ ] 检查目标用户 `union_id` 是否为空(`select id,name,union_id from public.users where union_id is null`)
- [ ] 执行 SQL 建表存待办 ID(否则完成时无法回写状态)
  ```sql
  create table if not exists public.task_todos (
    id         uuid primary key default gen_random_uuid(),
    task_id    uuid not null references public.tasks(id) on delete cascade,
    user_id    uuid not null references public.users(id) on delete cascade,
    todo_id    varchar(64) not null,
    done       boolean default false not null,
    created_at timestamptz default now() not null
  );
  alter table public.task_todos enable row level security;
  create index if not exists idx_task_todos_task on public.task_todos(task_id);
  ```

---

## 2. 每日未完成工作提醒 + 设置页权限 —— 已实现（待执行 SQL）

**⚠️ 上线前必须先做**:在 Supabase 的 SQL Editor 里执行 [`sql/migration_v3.sql`](sql/migration_v3.sql),否则 `duty` 列和提醒配置表不存在,设置页的这两个区块不会出现。

**已完成**

- [x] 建表 `daily_digest_settings`(见 migration_v3.sql)
- [x] 设置页(Settings.vue)新增「每日提醒」区块,**仅管理员 + 部门主任可见**
- [x] 接口 `GET/PUT /api/digest-settings`(权限:管理员 或 部门主任)
- [x] 接口 `GET /api/cron/daily-digest`,按分类分组列出未完成任务 + 剩余天数 + 负责人 + 审核人
- [x] `cron-worker/wrangler.toml` 加第二条 cron `*/30 * * * *`,`index.js` 按 `event.cron` 分流(已部署)
- [x] 重复发送防护:每条配置记 `last_sent_slot`,同一天同一时段只发一次

**设计要点**

- 每人自己配:**开关 / 关注哪些分类 / 几点收**(北京时间整点 0-23)
- 定时器每 30 分钟醒一次;后端只在 **:00 那一档**真正发送,所以每人每天只收 1 条
- 原「明天到期」提醒(每天 01:00 UTC = 09:00 北京)行为不变
- 手动测试:`https://dingtalk-task-cron.<子域>.workers.dev/?secret=xxx&target=digest`

**建议的 SQL** —— 见 [`sql/migration_v3.sql`](sql/migration_v3.sql)

---

## 3. 「部门主任 / 值长」的识别与自动带出 —— 已实现（待执行 SQL）

**⚠️ 上线前必须先做**:执行 [`sql/migration_v3.sql`](sql/migration_v3.sql) 加上 `duty` 列,再去设置页把每个人的职务标好。

**已完成**

- [x] `users` 加 `duty` 字段(见 migration_v3.sql),取值 `department_head` / `team_a_lead` / `team_b_lead` / `member`
- [x] 设置页新增「成员职务」区块(**仅管理员可见**),下拉直接改
- [x] 接口 `PUT /api/users/:id/duty`(仅管理员)
- [x] `GET /api/me`、`GET /api/users` 返回 `duty`(列不存在时自动回退,不会报错)
- [x] 新建 / 编辑任务页:选「部门任务」时,若该职务**唯一匹配**,自动带出部门主任(可手动改)
- [x] 后端 `POST /api/tasks` 兜底:没传 `department_head_id` 且分类是部门任务时,按职务自动推导

**有意没做的部分**

- 自动带出**只对「部门任务」生效**。运行一值/二值 的班组任务,负责人是下面单独选的,没有动原有创建流程 —— 避免擅自改变班组任务的字段与通知对象。
- `team_a_lead` / `team_b_lead` 目前只是**身份标签**(回答"谁是一值/二值值长"),还没有绑到任务字段上。
  > 如果希望值长也自动带出(比如当默认审核人,或也写进"部门审批"),告诉我,我再接。

**建议的 SQL** —— 见 [`sql/migration_v3.sql`](sql/migration_v3.sql)(末尾附了初始化职务的示例语句)


---

## 4. 遗留提醒

- [ ] Cloudflare API Token 已在对话中明文出现过,建议去后台删除并重新生成
