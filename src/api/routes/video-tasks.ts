import Request from "@/lib/request/Request.ts";
import { getTask, getAllTasks } from "@/lib/video-task-db.ts";

export default {
  prefix: "/v1/videos",

  get: {
    "/tasks": async (_request: Request) => {
      const tasks = getAllTasks();
      return { data: tasks };
    },

    "/tasks/:id": async (request: Request) => {
      const task_id = request.params?.id;
      if (!task_id) throw new Error("缺少任务 ID");
      const task = getTask(task_id);
      if (!task) throw new Error(`任务不存在: ${task_id}`);
      return task;
    },
  },
};
