# 知简

> 知于简，行于远。

一个面向公务员考试行测的 Cloudflare 原生刷题项目。界面参考常见考试答题卡与成绩报告的交互方式，已包含从组卷到复盘的完整闭环。

## 已实现

- 五大题库分类：政治理论、常识判断、言语理解与表达、数量关系、资料分析
- 多分类组合组卷，可自定义题目数量
- 不限时或 10 / 20 / 30 / 60 分钟限时，到时自动交卷
- 答题卡、做题进度、题目标记、未答提醒
- 自动判分、正确/错误/未答统计、用时与正确率
- 全部/错题/正确筛选，逐题答案对照与折叠解析
- 练习历史、错题自动归集、错题重练
- 本地离线存储 + Cloudflare D1 云端同步
- 桌面端与移动端响应式布局

项目内置 25 道演示题；正式使用时可继续通过 D1 批量导入题目。

## 技术结构

- 前端：React 19、TypeScript、Vite、Lucide Icons
- 后端：Cloudflare Workers、Hono、Zod
- 数据库：Cloudflare D1
- 静态资源：Cloudflare Workers Static Assets

目前题目均为结构化文本，D1 足够使用，因此没有接入 R2。后续若题干或资料分析包含大量图片、PDF、音视频，再将附件存入 R2，并在 `questions` 表中保存对象键即可。

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

2. 将命令返回的 `database_id` 填入 `wrangler.jsonc`，替换 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。

3. 应用远程迁移并部署：

```bash
pnpm db:remote
pnpm deploy
```

## 数据说明

- `migrations/0001_init.sql`：分类、题目、答题记录表结构
- `migrations/0002_seed_questions.sql`：五类演示题数据
- `worker/index.ts`：分类、随机取题、答题记录同步 API
- `src/data.ts`：前端离线演示题；正式题库扩充后可改为完全由 `/api/questions` 获取

当前使用匿名设备 ID 关联答题记录，适合首版 MVP。若要面向公开用户运营，下一步建议接入 Cloudflare Access 或第三方 OAuth，并将 `user_key` 升级为正式用户 ID。
