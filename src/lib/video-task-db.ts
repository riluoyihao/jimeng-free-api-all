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

let db: Database.Database;

export function initDb(): void {
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

/** 生成视频文件名，同名自增序号 */
export function generateVideoName(episode: number, videoNumber: number, title: string): string {
  const base = `EP${episode}_video${videoNumber}_${title}`;
  let index = 1;
  while (index <= 999) {
    const name = `${base}_${String(index).padStart(2, "0")}.mp4`;
    const row = db.prepare("SELECT 1 FROM video_tasks WHERE video_name = ?").get(name);
    if (!row) return name;
    index++;
  }
  return `${base}_${Date.now()}.mp4`;
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
  db.prepare(`
    INSERT INTO video_tasks (task_id, history_id, video_name, save_path, refresh_token, status, error, created_at, completed_at)
    VALUES (@task_id, @history_id, @video_name, @save_path, @refresh_token, @status, @error, @created_at, @completed_at)
  `).run(task);
  return task;
}

export function updateTaskHistoryId(task_id: string, history_id: string): void {
  db.prepare("UPDATE video_tasks SET history_id = ? WHERE task_id = ?").run(history_id, task_id);
}

export function updateTaskStatus(task_id: string, status: TaskStatus, error?: string): void {
  db.prepare("UPDATE video_tasks SET status = ?, error = ? WHERE task_id = ?")
    .run(status, error || null, task_id);
}

export function updateTaskCompleted(task_id: string): void {
  db.prepare("UPDATE video_tasks SET status = 'completed', completed_at = ? WHERE task_id = ?")
    .run(Math.floor(Date.now() / 1000), task_id);
}

export function getTask(task_id: string): VideoTask | null {
  return db.prepare("SELECT * FROM video_tasks WHERE task_id = ?").get(task_id) as VideoTask | null;
}

export function getAllTasks(): VideoTask[] {
  return db.prepare("SELECT * FROM video_tasks ORDER BY created_at DESC").all() as VideoTask[];
}

export function getPendingTasks(): VideoTask[] {
  return db.prepare("SELECT * FROM video_tasks WHERE status = 'pending' OR status = 'running'").all() as VideoTask[];
}
