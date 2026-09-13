# 智识反诈团日活动 H5

这是一个面向活动现场的反诈知识闯关小游戏。参与者通过手机答题，管理员统一开局，现场大屏通过监控页展示进度和排行榜。

本仓库基于 [qian-mengjia/anti-fraud-quiz](https://github.com/qian-mengjia/anti-fraud-quiz) fork 并改造，目标部署地址为 `https://quiz.arsvine.com`。

## 功能

- 学生答题页：`/`
- 管理员控制台：`/admin`
- 电脑实时监控页：`/monitor`
- 50 道题库中为每位参与者随机分配 15 道题
- 每题 15 秒，答对得 1 分，超时自动进入下一题
- 管理员可开始、提前结束和重置活动
- Vercel Functions + Redis 共享房间状态，适配多人同时访问

## 本地运行

需要 Node.js 18 或更高版本。

```powershell
npm ci
npm test
npm start
```

启动后访问：

- 学生页：<http://localhost:3000/>
- 管理员页：<http://localhost:3000/admin>
- 监控页：<http://localhost:3000/monitor>

本地默认使用进程内存存储，管理员口令为 `2026`。如需覆盖配置，可以在启动前设置环境变量；例如：

```powershell
$env:ADMIN_PIN = 'local-event-pin'
$env:QUIZ_STORAGE = 'memory'
npm start
```

[`.env.example`](.env.example) 是部署配置模板。`.env` 已被 Git 忽略，不能把真实口令或 Redis 凭据提交到仓库。

## 部署到 Vercel

代码中的 Vercel 部署准备已经完成：

- `api/` 下的函数提供所有答题、管理员和监控接口。
- `vercel.json` 将 `/admin` 和 `/monitor` 映射到对应 HTML 页面，并为 API 设置禁止缓存响应头。
- `public/` 继续作为静态资源目录。
- Vercel 环境默认使用 Redis；不会依赖某一个函数实例的本地内存。
- Redis 写操作带有短时分布式锁，避免多人同时加入或提交时互相覆盖房间状态。
- 当前 `api/` 只有 12 个 Function 入口；`/api/health` 通过重写复用 `api/meta.js`，不要随意再增加独立的 `api/*.js` 文件。

### Vercel 环境变量

在 Vercel 项目的 Settings → Environment Variables 中，为 Preview 和 Production 按需要添加：

| 变量 | 必需 | 用途 |
| --- | --- | --- |
| `ADMIN_PIN` | 是 | 管理员口令。请设置活动专用口令，不要使用示例值。 |
| `UPSTASH_REDIS_REST_URL` | 是 | Upstash Redis REST 地址。 |
| `UPSTASH_REDIS_REST_TOKEN` | 是 | Upstash Redis REST Token。 |
| `PUBLIC_BASE_URL` | Production 推荐 | 二维码使用的公网根地址；Production 活动环境设为 `https://quiz.arsvine.com`，Preview 可以留空以使用当前预览地址。 |
| `QUIZ_REDIS_PREFIX` | 否 | Redis 命名空间；不同活动可改成新的值。 |

如果通过旧版 Vercel/Upstash 集成获得的是 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`，代码也兼容这两个变量名。优先使用 [Vercel Marketplace 的 Upstash Redis](https://vercel.com/marketplace/upstash/upstash-kv) 或 Upstash 控制台创建 Redis，并将凭据只保存到 Vercel 环境变量中。

### 导入项目

在 Vercel 中导入 GitHub 仓库 `ArsvineZhu/anti-fraud-quiz`，项目根目录保持仓库根目录。该项目是静态 HTML + Node.js Functions：不需要构建命令；如果控制台要求填写 Output Directory，使用 `public`。

部署前先填写 Redis 和 `ADMIN_PIN`，否则页面可以打开，但答题接口无法建立跨函数共享的房间状态，管理员接口也会提示缺少配置。

部署完成后，先打开 `https://quiz.arsvine.com/api/health`。预期返回 `{"ok":true,"storage":"redis"}`；确认 `storage` 为 `redis` 后再把网址或二维码发给同学。活动应使用 Production Deployment 的自定义域名，不要把受访问保护的 Preview URL 作为现场入口。

### 绑定活动域名

在 Vercel 项目的 Settings → Domains 中添加 `quiz.arsvine.com`。Vercel 会显示该项目对应的 DNS 记录；到域名服务商处为 `quiz` 配置 Vercel 要求的 CNAME，等待验证完成后再使用活动二维码。域名配置以 [Vercel 自定义域名文档](https://vercel.com/docs/domains/set-up-custom-domain) 显示的记录为准。

### 活动操作顺序

1. 打开 `https://quiz.arsvine.com/admin`，输入 `ADMIN_PIN`。
2. 将管理员页显示的二维码投到大屏。
3. 参与者扫码进入 `/` 并输入昵称。
4. 人员到齐后点击“开始游戏”，电脑屏幕打开 `/monitor`。
5. 下一场活动开始前点击“重置本局”，清空上一场的参赛名单和成绩。

Redis 中的房间状态会跨函数实例和重新部署保留；每场活动结束后应使用管理员页的“重置本局”，或通过新的 `QUIZ_REDIS_PREFIX` 开启独立房间。

### 活动结束后关闭

1. 在管理员页点击“结束本局”，确认不再需要成绩后再清理数据。
2. 在 Vercel 项目的 Domains 设置中移除 `quiz.arsvine.com`，停止继续对外提供活动入口。
3. 如果这次活动不再需要保留项目，删除对应的 Vercel Project；如果还要复用代码，可以只保留仓库和项目配置。
4. 在 Vercel Marketplace/Upstash 中删除或解除本次活动使用的 Redis 资源。Redis 中保存的昵称、成绩和答题动态会随资源删除而不可恢复。

## 题库和页面改编

- 题目内容位于 [`data/questions.js`](data/questions.js)，`answer` 是从 `0` 开始的选项索引。
- 学生页脚本位于 [`public/app.js`](public/app.js)，管理员页和监控页分别使用 [`public/admin.js`](public/admin.js) 与 [`public/monitor.js`](public/monitor.js)。
- 页面样式位于 [`public/styles.css`](public/styles.css)、[`public/admin.css`](public/admin.css) 和 [`public/monitor.css`](public/monitor.css)。
- [`local-server.js`](local-server.js) 仅用于本地 HTTP 入口；Vercel 线上路由不依赖它，只通过 [`api/`](api) 中的 Functions 处理 API。

## 验证

```powershell
npm test
```

测试覆盖游戏状态规则，以及本地 API handler 的加入、开局、答题、排行榜、管理员鉴权和公网 URL 生成。

## 来源

上游仓库：[qian-mengjia/anti-fraud-quiz](https://github.com/qian-mengjia/anti-fraud-quiz)。本 fork 保留原项目的活动玩法，并增加 Vercel Functions、Redis 状态存储和自定义域名部署配置。
