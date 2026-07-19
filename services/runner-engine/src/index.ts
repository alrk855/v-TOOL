import { config } from "./config.js";
import { claimTask } from "./dashboardClient.js";
import { executeTask } from "./runner.js";

let activeCount = 0;

console.log("runner-engine-service started", {
  dashboardApiBase: config.dashboardApiBase,
  runnerConcurrency: config.runnerConcurrency,
  pollIntervalMs: config.pollIntervalMs
});

setInterval(() => {
  void poll();
}, config.pollIntervalMs);

void poll();

async function poll() {
  // Allow claiming new tasks as long as we have concurrency headroom
  if (activeCount >= config.runnerConcurrency) {
    return;
  }

  try {
    const task = await claimTask();
    if (!task) return;

    activeCount++;
    console.log(`claimed task ${task.id} target=${task.targetUrl} active=${activeCount}/${config.runnerConcurrency}`);

    // Run without awaiting so poll() can continue to claim more tasks
    executeTask(task)
      .catch((error) => {
        console.error(`task ${task.id} failed:`, error);
      })
      .finally(() => {
        activeCount--;
        // Immediately poll for more work once a slot frees up
        void poll();
      });

    // Try to fill more concurrency slots in this same tick
    if (activeCount < config.runnerConcurrency) {
      void poll();
    }
  } catch (error) {
    console.error("poll error:", error);
  }
}
