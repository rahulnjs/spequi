import { inventory } from './specs.mjs';
import { localReadiness } from './openspec-cli.mjs';

// Browsing never waits for a CLI process. Mutating actions still use fresh localReadiness.
export function createWorkspaceState(root, { check = localReadiness, changed = () => {} } = {}) {
  let tree, generation = 0, running = false, closed = false;
  const entries = new Map(), queue = new Set(), abort = new AbortController();
  async function data() {
    if (!tree) {
      const current = generation;
      const promise = inventory(root);
      tree = promise;
      // Coalesce concurrent reads, but never serve a directory listing older than navigation.
      promise.finally(() => { if (tree === promise && current === generation) tree = null; }).catch(() => {});
    }
    return tree;
  }
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (queue.size && !closed) {
        const change = [...queue].at(-1);
        queue.delete(change);
        const entry = entries.get(change);
        if (!entry) continue;
        try { entry.value = await check(root, change, { signal: abort.signal }); }
        catch (error) { entry.error = error.message; }
        entry.pending = false;
        if (entries.get(change) === entry && !closed) changed(change, entry.value);
      }
    } finally { running = false; }
  }
  function readiness(change) {
    let entry = entries.get(change);
    if (!entry) {
      entry = { pending: true }; entries.set(change, entry); queue.add(change);
      void drain();
    }
    if (entry.error) throw new Error(entry.error);
    return entry.value || null;
  }
  function invalidate(change) {
    tree = null; generation++;
    if (change) entries.delete(change); else entries.clear();
  }
  return { data, readiness, invalidate, close() { closed = true; queue.clear(); abort.abort(); } };
}
