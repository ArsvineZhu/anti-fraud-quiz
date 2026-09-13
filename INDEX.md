# 仓库导航

这是一个单体活动 H5。第一次使用、环境变量和 Vercel 操作以 [README.md](README.md) 为准。

## 主要入口

- [学生答题页](public/index.html)：参与者加入房间并完成答题。
- [管理员控制台](public/admin.html)：验证口令、开始/结束/重置活动、展示二维码。
- [实时监控页](public/monitor.html)：展示现场排行榜、进度和答题动态。

## 代码边界

- [`api/`](api)：Vercel Functions 路由入口；每个文件转发到共享 API handler。
- [`lib/quiz-api.js`](lib/quiz-api.js)：HTTP API 行为、鉴权、响应和房间投影的唯一实现。
- [`lib/game-store.js`](lib/game-store.js)：本地内存存储与 Vercel Redis 存储适配，以及跨函数写锁。
- [`lib/game-state.js`](lib/game-state.js)：纯游戏状态规则与排行榜计算。
- [`data/questions.js`](data/questions.js)：题库；`answer` 使用从 `0` 开始的选项索引。
- [`public/`](public)：静态页面、浏览器脚本和样式。
- [`server.js`](server.js)：本地 HTTP 运行入口。

## 部署配置

- [`vercel.json`](vercel.json)：静态页面重写、Functions 配置和 API 响应头。
- [`.env.example`](.env.example)：本地/部署环境变量模板，不含真实凭据。

验证命令和活动部署步骤集中维护在 [README.md](README.md) 中。
