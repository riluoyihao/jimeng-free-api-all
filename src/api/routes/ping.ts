import { getPollerLastPollAt, isPollerHealthy } from "@/lib/video-task-poller.ts";

export default {
  prefix: '/ping',
  get: {
    '': async () => ({
      message: "pong",
      poller_last_run: getPollerLastPollAt(),
      poller_status: isPollerHealthy() ? "healthy" : "stale",
    })
  }
}
