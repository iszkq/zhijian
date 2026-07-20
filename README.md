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
- Word 批量导入：题本与解析自动配对，保留题型、批注、下划线和实战解析，支持追加更新或替换分类
- 所有分类均支持可选题目配图，图片存储在 Cloudflare R2
- 按账号隔离的本地缓存 + Cloudflare D1 云端同步
- 桌面端与移动端响应式布局

项目当前已导入 600 道片段阅读题；后续同格式 Word 题本可直接从管理后台导入，导入过程先预览校验，再分批写入 D1。

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

## 从 Word 导入题库

登录管理员账号后打开“管理后台 → Word 导入”：

1. 选择题本 Word，可同时选择上、下册等多个文件。
2. 选择对应的解析 Word，文件数量要与题本一致；系统会按文件名中的“上/下”及文件顺序配对。
3. 选择目标分类和导入方式。“追加并更新重复题”适合继续扩充题库；“清空该分类后重新导入”会先删除该分类旧题。
4. 点击“解析并校验”，确认题数、配对结果、参考答案、实战解析和批注预览无误后，再点击确认导入。

导入使用暂存表和分批上传，浏览器中断不会留下半道题。重复上传同一题本会按题干、选项和来源更新已有题目，不会无限重复增加。

## 数据说明

- `migrations/0001_init.sql`：分类、题目、答题记录表结构
- `migrations/0002_seed_questions.sql`：五类演示题数据
- `migrations/0003_auth.sql`：用户、登录会话与账号答题记录隔离
- `migrations/0004_admin_media.sql`：管理员角色与题目图片字段
- `migrations/0005_replace_with_reading_600.sql`：600 道片段阅读题与详细解析
- `migrations/0006_word_imports.sql`：Word 批量导入暂存与幂等更新
- `worker/index.ts`：登录鉴权、题库、后台 CRUD、R2 图片与答题记录 API
- `src/docxImporter.ts`：浏览器端 DOCX 解包、题本/解析配对与格式提取
- `src/data.ts`：网络不可用时的前端演示题

## 设置首位管理员

先在网页正常注册自己的账号，再在 D1 Console 执行：

```sql
UPDATE users SET role = 'admin' WHERE username = '你的登录账号';
```

退出后重新登录，即可在顶部导航看到“管理后台”。不要设置公开的默认管理员密码。

账号密码使用 PBKDF2-SHA256 加盐哈希保存，登录凭证使用 HttpOnly、SameSite Cookie。不同账号的练习历史与错题数据分别保存。
