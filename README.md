# LabGo（Gitlab 助手）

LabGo 是一个基于 GitLab API v4 的轻量管理工具，可在浏览器中集中查看项目和流水线，并快速创建 Merge Request 与 Git Tag。

项目使用 Vite、TypeScript、原生 HTML 和 CSS 实现，无需单独部署后端服务。

## 功能

- 支持 GitLab.com 和自建 GitLab 实例
- 展示项目组及其直属项目
- 展示项目的默认分支、最新 Tag、最后活跃时间和最新流水线
- 自动刷新运行中的流水线状态
- 创建 Merge Request
- 为单个或多个项目创建同名 Tag
- 记录上次选择的项目组

## 本地运行

需要安装 [Bun](https://bun.sh/)。

```bash
bun install
bun run dev
```

检查并构建：

```bash
bun run fmt
bun run lint
bun run build
```

## Token 权限

- 查看项目、分支、Tag 和流水线：`read_api`
- 创建 Merge Request 或 Tag：`api`

Token 和 GitLab 地址保存在当前浏览器的 `localStorage` 中，请仅在可信设备上使用。自建 GitLab 还需允许当前站点访问其 API。
