# 知简

> 知于简，行于远。

一个面向公务员考试行测的 Cloudflare 原生刷题项目。界面参考常见考试答题卡与成绩报告的交互方式，已包含从组卷到复盘的完整闭环。

## 已实现

- 五大题库分类：政治理论、常识判断、言语理解与表达、数量关系、资料分析
- 多分类组合组卷，可在可用题量范围内自定义题目数量
- 自定义分钟数限时，0 表示不限时，到时自动交卷
- 答题卡、做题进度、题目标记、未答提醒
- 自动判分、正确/错误/未答统计、用时与正确率
- 全部/错题/正确筛选，逐题答案对照与折叠解析
- 练习历史、错题自动归集、错题详情解析、错题重练
- 注册登录、账号数据隔离与安全会话
- 管理员后台：账号、分类、题目的增删改查
- 所有分类均支持可选题目配图，图片存储在 Cloudflare R2
- 按账号隔离的本地缓存 + Cloudflare D1 云端同步
- 桌面端与移动端响应式布局

项目内置 25 道演示题；正式使用时可继续通过 D1 批量导入题目。

## 技术结构

- 前端：React 19、TypeScript、Vite、Lucide Icons
- 后端：Cloudflare Workers、Hono、Zod
- 数据库：Cloudflare D1
- 图片存储：Cloudflare R2
- 静态资源：Cloudflare Workers Static Assets

## 本地运行

```bash
pnpm install
pnpm dev
```

此模式访问 `http://localhost:5173`，答题记录会保存在浏览器本地。要连同 Worker 和本地 D1 一起运行：

```bash
pnpm build
pnpm db:local
pnpm cf:dev
```

然后访问 `http://localhost:8787`。

## 部署到 Cloudflare

1. 登录并创建 D1 数据库：

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create zhijian-db
```

2. 创建 R2 存储桶：

```bash
pnpm exec wrangler r2 bucket create zhijian-media
```

3. 将 D1 命令返回的 `database_id` 填入 `wrangler.jsonc`。

4. 应用远程迁移并部署：

```bash
pnpm db:remote
pnpm deploy
```

## 数据说明

- `migrations/0001_init.sql`：分类、题目、答题记录表结构
- `migrations/0002_seed_questions.sql`：五类演示题数据
- `migrations/0003_auth.sql`：用户、登录会话与账号答题记录隔离
- `migrations/0004_admin_media.sql`：管理员角色与题目图片字段
- `worker/index.ts`：登录鉴权、题库、后台 CRUD、R2 图片与答题记录 API
- `src/data.ts`：网络不可用时的前端演示题

## 设置首位管理员

先在网页正常注册自己的账号，再在 D1 Console 执行：

```sql
UPDATE users SET role = 'admin' WHERE username = '你的登录账号';
```

退出后重新登录，即可在顶部导航看到“管理后台”。不要设置公开的默认管理员密码。

账号密码使用 PBKDF2-SHA256 加盐哈希保存，登录凭证使用 HttpOnly、SameSite Cookie。不同账号的练习历史与错题数据分别保存。
