import path from "path";
import Database from "better-sqlite3";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import logger from "@/lib/logger.ts";

const DB_PATH = path.join(path.resolve(), "data", "tasks.db");

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface VideoTask {
  task_id: string;
  history_id: string | null;
  video_name: string;
  save_path: string;
  refresh_token: string;
  status: TaskStatus;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) throw new Error("数据库尚未初始化，请先调用 initDb()");
  return db;
}

export function initDb(): void {
  if (db) return;
  fs.ensureDirSync(path.dirname(DB_PATH));
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_tasks (
      task_id       TEXT PRIMARY KEY,
      history_id    TEXT,
      video_name    TEXT NOT NULL,
      save_path     TEXT NOT NULL,
      refresh_token TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      error         TEXT,
      created_at    INTEGER NOT NULL,
      completed_at  INTEGER
    )
  `);
  logger.info(`SQLite 初始化完成: ${DB_PATH}`);
}

/** 生成视频名称前缀（不含序号），下载时再根据文件系统确定最终文件名 */
export function generateVideoName(episode: string | number, videoNumber: string | number, title: string): string {
  const episodePart = typeof episode === 'number' ? `EP${episode}` : episode;
  return `${episodePart}_video${videoNumber}_${title}`;
}

export function insertTask(params: {
  video_name: string;
  save_path: string;
  refresh_token: string;
  history_id?: string;
}): VideoTask {
  const task: VideoTask = {
    task_id: uuidv4(),
    history_id: params.history_id || null,
    video_name: params.video_name,
    save_path: params.save_path,
    refresh_token: params.refresh_token,
    status: "pending",
    error: null,
    created_at: Math.floor(Date.now() / 1000),
    completed_at: null,
  };
  getDb().prepare(`
    INSERT INTO video_tasks (task_id, history_id, video_name, save_path, refresh_token, status, error, created_at, completed_at)
    VALUES (@task_id, @history_id, @video_name, @save_path, @refresh_token, @status, @error, @created_at, @completed_at)
  `).run(task);
  return task;
}

export function updateTaskHistoryId(task_id: string, history_id: string): void {
  getDb().prepare("UPDATE video_tasks SET history_id = ? WHERE task_id = ?").run(history_id, task_id);
}

export function updateTaskStatus(task_id: string, status: TaskStatus, error?: string): void {
  getDb().prepare("UPDATE video_tasks SET status = ?, error = ? WHERE task_id = ?")
    .run(status, error || null, task_id);
}

/** 任务下载完成，更新最终文件名、完整路径和状态 */
export function updateTaskCompleted(task_id: string, video_name: string, save_path: string): void {
  getDb().prepare("UPDATE video_tasks SET status = 'completed', video_name = ?, save_path = ?, completed_at = ? WHERE task_id = ?")
    .run(video_name, save_path, Math.floor(Date.now() / 1000), task_id);
}

const TASK_COLUMNS = "task_id, history_id, video_name, save_path, status, error, created_at, completed_at";

export function getTask(task_id: string): Omit<VideoTask, "refresh_token"> | null {
  return getDb().prepare(`SELECT ${TASK_COLUMNS} FROM video_tasks WHERE task_id = ?`).get(task_id) as Omit<VideoTask, "refresh_token"> | null;
}

export function getAllTasks(): Omit<VideoTask, "refresh_token">[] {
  return getDb().prepare(`SELECT ${TASK_COLUMNS} FROM video_tasks ORDER BY created_at DESC`).all() as Omit<VideoTask, "refresh_token">[];
}

export function getActiveTasks(): VideoTask[] {
  return getDb().prepare("SELECT * FROM video_tasks WHERE status = 'pending' OR status = 'running'").all() as VideoTask[];
}
