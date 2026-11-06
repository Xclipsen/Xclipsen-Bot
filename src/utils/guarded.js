// Wraps a periodic task: skips a run while the previous one is still busy and logs failures instead of rejecting.
function guarded(name, fn) {
  let running = false;
  return async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      await fn();
    } catch (error) {
      console.error(`${name} failed:`, error);
    } finally {
      running = false;
    }
  };
}

module.exports = { guarded };
