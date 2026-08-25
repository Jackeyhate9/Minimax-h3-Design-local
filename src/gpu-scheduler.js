export function createGpuScheduler(logger = console) {
  let tail = Promise.resolve();
  let active = null;
  let queued = 0;

  return {
    async run(label, task) {
      queued += 1;
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const previous = tail;
      tail = previous.catch(() => undefined).then(() => gate);
      await previous.catch(() => undefined);
      queued -= 1;
      active = label;
      logger.log(`[h3-local] GPU slot acquired: ${label}`);
      try {
        return await task();
      } finally {
        logger.log(`[h3-local] GPU slot released: ${label}`);
        active = null;
        release();
      }
    },
    status() {
      return { active, queued };
    }
  };
}
