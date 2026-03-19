# 设计文档：异步视频生成 + Storyboard 接口

**日期：** 2026-03-19
**版本：** v0.9.0

---

## 背景

当前 `POST /v1/videos/generations` 是同步阻塞接口，需等待视频生成完成（通常数分钟）才返回。对于批量视频生成场景（如分镜驱动的视频批量制作），阻塞接口会导致请求超时，且无法管理任务进度。

---

## 目标

1. 新增非阻塞的 Storyboard 驱动视频生成接口
2. 自动从 JSON 分镜文件解析参数，无需手动拼装 prompt
3. 后台异步下载完成的视频到指定路径
4. 提供任务状态查询接口
5. 保证后台 Poller 的可靠性（心跳自检）
6. 端口从 8000 改为 8012

---

## 接口设计

### 新增：`POST /v1/videos/storyboard`

非阻塞提交接口，从 Storyboard JSON 文件解析参数后提交视频生成任务，立即返回。

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `storyboard_path` | string | 是 | Storyboard JSON 文件的绝对路径 |
| `parentpath` | string | 是 | 素材根目录，用于拼接 `image_path` 和 `save_path` |
| `save_path` | string | 是 | 相对路径，最终保存路径 = `parentpath` + `save_path` + `video_name` |
| `model` | string | 否 | 默认 `jimeng-video-seedance-2.0` |
| `resolution` | string | 否 | 默认 `720p` |

#### 从 JSON 自动解析的参数

| JSON 字段 | 映射到 | 说明 |
|-----------|--------|------|
| `aspect_ratio` | `ratio` | 视频宽高比 |
| `duration_seconds` | `duration` | 视频时长（秒） |
| `reference_images[].image_path` | `files` | 素材文件，绝对路径 = `parentpath` + `image_path` |

#### Prompt 拼接规则

```
{style}
{references}
{timeline}
音效：{sound_effects}
配乐：{music}
```

#### video_name 命名规则

```
EP{episode}_video{video_number}_{title}_{序号}.mp4
```

- 序号从 `01` 开始
- 若数据库中已存在同名记录，序号自增（`_01` → `_02` → ...）

#### 响应（立即返回）

```json
{
  "task_id": "uuid-xxxx",
  "video_name": "EP1_video3_催租窘境_01.mp4",
  "status": "pending"
}
```

---

### 新增：`GET /v1/videos/tasks`

查询所有视频任务列表。

#### 响应

```json
{
  "data": [
    {
      "task_id": "uuid-xxxx",
      "history_id": "jimeng-history-id",
      "video_name": "EP1_video3_催租窘境_01.mp4",
      "save_path": "/Users/xxx/project/output/EP1_video3_催租窘境_01.mp4",
      "status": "pending | running | completed | failed",
      "error": null,
      "created_at": 1710000000,
      "completed_at": null
    }
  ]
}
```

---

### 新增：`GET /v1/videos/tasks/:id`

查询单个任务状态，字段同上。

---

### 修改：`GET /ping`

在原有响应中新增 poller 心跳信息：

```json
{
  "message": "pong",
  "poller_last_run": 1710000000,
  "poller_status": "healthy | stale"
}
```

---

## 架构设计

### 数据流

```
POST /v1/videos/storyboard
  ↓
1. 读取 storyboard_path JSON 文件
2. 解析 prompt / ratio / duration / files / video_name
3. 调用 submitVideo()（内部函数，仅提交任务，不轮询）
4. 获得 history_id
5. 写入 SQLite (status=pending)
6. 立即返回 { task_id, video_name, status }

后台 Poller（每 30 秒）
  ↓
1. 查询所有 status=pending 的任务
2. 对每个任务调用 queryVideoStatus(history_id)
3. 已完成 → 下载视频到 save_path → 更新 status=completed
4. 失败 → 更新 status=failed + error 字段

Watchdog（每 60 秒）
  ↓
1. 检查 poller 最后执行时间 lastPollAt
2. 若超过 90 秒未执行 → 停止并重启 cron job
3. 更新 /ping 暴露的健康状态
```

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/lib/video-task-db.ts` | SQLite 初始化、增删查改封装（使用 better-sqlite3） |
| `src/lib/video-task-poller.ts` | cron 后台轮询 + Watchdog 心跳自检 |
| `src/api/routes/video-tasks.ts` | `GET /v1/videos/tasks` 和 `GET /v1/videos/tasks/:id` 路由 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/api/controllers/videos.ts` | 拆出 `submitVideo()` 函数（只提交不轮询）、导出 `queryVideoStatus()` |
| `src/api/routes/videos.ts` | 新增 `POST /v1/videos/storyboard` 路由 |
| `src/api/routes/index.ts` | 注册 video-tasks 路由 |
| `src/index.ts` | 启动时初始化 DB + 启动 poller |
| `src/api/routes/ping.ts` | 返回 poller 心跳信息 |
| `package.json` | 端口 8000 → 8012，新增 better-sqlite3 依赖 |

---

## 数据库设计

### SQLite 文件位置

`data/tasks.db`（项目根目录）

### 表结构

```sql
CREATE TABLE IF NOT EXISTS video_tasks (
  task_id      TEXT PRIMARY KEY,
  history_id   TEXT,
  video_name   TEXT NOT NULL,
  save_path    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  error        TEXT,
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);
```

### status 状态流转

```
pending → running → completed
                 → failed
```

---

## 可靠性设计

### Poller 可靠性

- 整个 poll 回调包裹在 `try/catch` 中，单次异常不影响下次执行
- 每个任务独立 `try/catch`，一个任务失败不影响其他任务
- 所有任务状态持久化在 SQLite，进程重启后自动续接 pending 任务

### Watchdog 心跳自检

- Poller 每次成功执行后更新内存变量 `lastPollAt`
- Watchdog 每 60 秒检查一次 `lastPollAt`
- 若距上次执行超过 90 秒，自动 `stop()` + `start()` 重启 cron job 并记录告警日志
- `/ping` 接口暴露 `poller_last_run` 和 `poller_status`，供外部监控系统使用

### 进程级崩溃恢复

- 建议配合 PM2 的 `--watch` 或 Docker `restart: always` 策略
- 进程重启后，SQLite 中的 pending 任务会在下一次 poll 时自动恢复

---

## 端口变更

默认端口从 **8000** 改为 **8012**，涉及：
- `package.json` dev/start 脚本
- 相关配置文件和文档
