# LabGo（Gitlab 助手）

LabGo 是一个简洁的 GitLab 可视化管理工具，中文名为“Gitlab 助手”，仓库名为 `lab-go`。它基于 GitLab API v4，在浏览器中统一查看项目组、项目和流水线，并完成常用的合并请求与 Git Tag 操作。

项目使用 Vite、原生 HTML、TypeScript 和 CSS 实现，不依赖前端框架，也不需要单独部署后端服务。

## 项目作用

Gitlab 助手面向同时维护多个 GitLab 项目的开发者，减少在不同项目页面之间反复切换的操作成本：

- 在一个页面查看当前用户加入的项目组及其直属项目
- 快速了解各项目最近一次流水线状态
- 为单个项目快速创建合并请求
- 为单个或多个项目统一创建 Git Tag
- 同时支持 GitLab.com 和自建 GitLab 实例

## 当前功能

### 连接 GitLab

- 默认使用 `https://gitlab.com`，也可以输入自建 GitLab 地址
- 使用 Personal Access Token 调用 GitLab API v4
- GitLab 地址和 Token 保存在当前浏览器的 `localStorage` 中
- 缺少地址或 Token 时自动返回连接页面
- 更换连接时清除当前 Token 和已选择的项目组

### 项目组与项目

- 展示当前用户加入的项目组及项目组描述
- 展示项目组内的直属项目、项目 ID、项目描述和默认分支
- 不包含子项目组项目和共享到当前项目组的项目
- 点击实例地址、项目名称可直接进入对应 GitLab 页面
- 自动记录当前选中的项目组，下次打开时继续恢复

### 流水线状态

- 项目列表渲染完成后异步加载流水线，不阻塞项目展示
- 展示项目所有分支和 Tag 中最近一次流水线的状态与来源
- 点击状态可直接进入 GitLab 流水线详情
- 运行中、等待中等未结束状态每 15 秒自动刷新
- 无流水线或加载失败时显示对应提示

### 创建合并请求

- 每个项目都可以快速创建 Merge Request
- 自动加载项目分支，并优先将默认分支作为目标分支
- 支持选择源分支、目标分支并填写标题和描述
- 创建时固定保留源分支，不压缩提交
- 创建成功后可直接进入 GitLab 合并请求页面

工具只负责创建合并请求，不会自动接受或合并。Fast-forward 等合并方式由 GitLab 项目配置决定；如果项目策略强制删除源分支或压缩提交，最终以 GitLab 项目规则为准。

### 创建 Git Tag

- 支持为单个项目创建 Tag
- 支持勾选多个项目后批量创建同名 Tag
- 可以使用各项目默认分支，也可以指定所有项目使用同名分支
- 创建前检查分支是否存在以及同名 Tag 是否已存在
- 批量操作使用受控并发，并分别展示每个项目的执行结果

创建 Tag 可能触发项目已有的 CI/CD 流水线。

## 界面特点

- 单屏管理布局，左侧项目组、右侧项目列表
- 仅使用白、黑、灰三类颜色
- 紧凑、清晰，适合中文阅读习惯
- 桌面端和窄屏窗口均可使用

## 本地运行

环境要求：

- Bun
- 支持 ES Modules 的现代浏览器
- 浏览器能够访问目标 GitLab 实例及其 API

安装依赖并启动开发环境：

```bash
bun install
bun run dev
```

代码检查与构建：

```bash
bun run fmt
bun run lint
bun run build
```

预览生产构建：

```bash
bun run preview
```

## Token 权限

- 浏览项目组、项目、分支和流水线：`read_api`
- 创建合并请求或 Git Tag：`api`

除 Token 权限外，当前 GitLab 用户还需要拥有对应项目的操作权限，Protected Branch 和 Protected Tag 等项目规则仍会正常生效。

## 数据与安全

本项目直接从浏览器请求 GitLab API，不会把 Token 发送到其他服务，但 Token 会明文保存在当前浏览器的 `localStorage` 中。因此：

- 仅在可信设备和可信浏览器环境中使用
- 为 Token 设置合理的权限范围和有效期
- 不要在公共或共享设备上长期保存 Token
- 自建 GitLab 需要允许当前站点跨域访问 API，并使用浏览器信任的 HTTPS 证书

## 技术栈

- Vite
- TypeScript
- 原生 HTML
- 原生 CSS
- GitLab REST API v4
- Bun
