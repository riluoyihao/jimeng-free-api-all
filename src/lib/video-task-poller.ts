import path from "path";
import fs from "fs-extra";
import axios from "axios";
import { CronJob } from "cron";
import logger from "@/lib/logger.ts";
import {
  getActiveTasks,
  updateTaskStatus,
  updateTaskCompleted,
} from "@/lib/video-task-db.ts";
import { queryVideoTaskStatus } from "@/api/controllers/videos.ts";
import { generateCookie } from "@/api/controllers/core.ts";

// 每次 poll 成功执行后更新此时间戳
let lastPollAt: number = Date.now();

export function getPollerLastPollAt(): number {
  return lastPollAt;
}

export function isPollerHealthy(): boolean {
  // 超过 90 秒未执行视为 stale
  return Date.now() - lastPollAt < 90_000;
}

/** 根据文件系统确定最终文件路径（自增序号直到不存在） */
function resolveVideoFilePath(saveDir: string, namePrefix: string): string {
  for (let seq = 1; seq <= 999; seq++) {
    const filename = `${namePrefix}_${String(seq).padStart(2, "0")}.mp4`;
    const fullPath = path.join(saveDir, filename);
    if (!fs.existsSync(fullPath)) return fullPath;
  }
  return path.join(saveDir, `${namePrefix}_${Date.now()}.mp4`);
}

/** 下载视频文件到指定路径 */
async function downloadVideo(videoUrl: string, savePath: string, refreshToken: string): Promise<void> {
  await fs.ensureDir(path.dirname(savePath));
  const response = await axios.get(videoUrl, {
    responseType: "stream",
    timeout: 5 * 60 * 1000,
    headers: { Cookie: generateCookie(refreshToken) },
  });
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(savePath);
    response.data.pipe(writer);
    response.data.on("error", (err: Error) => {
      writer.destroy();
      fs.remove(savePath).catch(() => {});
      reject(err);
    });
    writer.on("finish", resolve);
    writer.on("error", (err: Error) => {
      fs.remove(savePath).catch(() => {});
      reject(err);
    });
  });
  logger.info(`视频已下载到: ${savePath}`);
}

/** 单次轮询所有活跃任务（pending + running） */
async function pollActiveTasks(): Promise<void> {
  const tasks = getActiveTasks();
  if (tasks.length === 0) {
    lastPollAt = Date.now();
    return;
  }

  logger.info(`[Poller] 轮询 ${tasks.length} 个未完成任务`);

  for (const task of tasks) {
    if (!task.history_id) {
      logger.warn(`[Poller] 任务 ${task.task_id} 没有 history_id，跳过`);
      continue;
    }

    if (!task.refresh_token) {
      logger.warn(`[Poller] 任务 ${task.task_id} 缺少 refresh_token，跳过`);
      continue;
    }

    try {
      updateTaskStatus(task.task_id, "running");

      const result = await queryVideoTaskStatus(task.history_id, task.refresh_token);

      if (!result.done) {
        // 仍在处理中，回退为 pending 等待下次轮询
        updateTaskStatus(task.task_id, "pending");
        continue;
      }

      if (result.failed) {
        updateTaskStatus(task.task_id, "failed", result.error);
        logger.error(`[Poller] 任务 ${task.task_id} 失败: ${result.error}`);
        continue;
      }

      if (result.videoUrl) {
        try {
          const finalPath = resolveVideoFilePath(task.save_path, task.video_name);
          const finalName = path.basename(finalPath);
          await downloadVideo(result.videoUrl, finalPath, task.refresh_token);
          updateTaskCompleted(task.task_id, finalName, finalPath);
          logger.info(`[Poller] 任务 ${task.task_id} 完成，视频已保存: ${finalPath}`);
        } catch (downloadErr) {
          updateTaskStatus(task.task_id, "failed", `视频下载失败: ${downloadErr.message}`);
          logger.error(`[Poller] 任务 ${task.task_id} 视频下载失败: ${downloadErr.message}`);
        }
      } else {
        updateTaskStatus(task.task_id, "failed", "完成但未获取到视频URL");
        logger.error(`[Poller] 任务 ${task.task_id} 完成但无视频URL`);
      }
    } catch (err) {
      logger.error(`[Poller] 处理任务 ${task.task_id} 时出错: ${err.message}`);
      // 出错回退为 pending，下次继续重试
      updateTaskStatus(task.task_id, "pending");
    }
  }

  lastPollAt = Date.now();
}

let pollerJob: CronJob | null = null;

function startPollerJob(): void {
  // cron 3.x: new CronJob(cronTime, onTick, onComplete, start, ...)
  // 第三个参数 onComplete = null，第四个参数 start = false，手动调用 .start()
  pollerJob = new CronJob(
    "*/30 * * * * *",
    async () => {
      try {
        await pollActiveTasks();
      } catch (err) {
        logger.error(`[Poller] 未预期错误: ${err.message}`);
      }
    },
    null,
    false
  );
  pollerJob.start();
  logger.info("[Poller] 视频任务轮询已启动（每 30 秒）");
}

/** 启动 Poller + Watchdog */
export function startVideoTaskPoller(): void {
  startPollerJob();

  // Watchdog: 每 60 秒检查 poller 是否正常执行
  setInterval(() => {
    if (!isPollerHealthy()) {
      logger.warn("[Watchdog] Poller 超过 90 秒未执行，正在重启...");
      if (pollerJob) {
        pollerJob.stop();
        pollerJob = null;
      }
      startPollerJob();
      logger.info("[Watchdog] Poller 已重启");
    }
  }, 60_000);

  logger.info("[Watchdog] 心跳监控已启动（每 60 秒检查）");
}
