// Last-good payload store with single-flight refresh and a disk snapshot.
//
// Homepage (and any other public "must render" surface) should call
// `resolve(key, builder)` instead of hitting Postgres on every request:
//   · fresh hit  → return it
//   · expired    → return last-good immediately, refresh in the background
//   · cold miss  → wait for the builder (bounded by the caller)
//   · builder fails → keep serving last-good; never wipe it
//
// The snapshot file is best-effort. Railway's disk dies on deploy, so it
// only covers blips *within* a process lifetime plus the rare case that
// tmpdir survives a restart. The in-memory last-good is the real guard.

const fs = require('fs');
const path = require('path');

function createStaleStore(opts = {}) {
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : 120 * 1000;
  const file = opts.file || null;
  const mem = new Map();
  const inflight = new Map();

  if (file) {
    try {
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(disk || {})) {
        if (v && v.data != null && v.ts) mem.set(k, { ts: v.ts, data: v.data });
      }
    } catch (_) { /* no snapshot yet */ }
  }

  function persist() {
    if (!file) return;
    const out = {};
    for (const [k, v] of mem) out[k] = { ts: v.ts, data: v.data };
    const dir = path.dirname(file);
    fs.promises.mkdir(dir, { recursive: true }).catch(() => {})
      .then(() => fs.promises.writeFile(file, JSON.stringify(out)))
      .catch(() => {});
  }

  function peek(key) {
    return mem.get(key) || null;
  }

  function put(key, data) {
    if (data == null) return;
    mem.set(key, { ts: Date.now(), data });
    persist();
  }

  async function resolve(key, builder) {
    const hit = mem.get(key);
    if (hit && Date.now() - hit.ts < ttlMs) {
      return { data: hit.data, stale: false };
    }

    if (!inflight.has(key)) {
      const p = Promise.resolve()
        .then(builder)
        .then((data) => {
          if (data != null) put(key, data);
          return data;
        })
        .catch((err) => {
          // Swallow into the inflight promise so a waiting cold miss can
          // still fall through to last-good below. Re-throw only when
          // there is nothing to serve.
          if (mem.get(key)) return null;
          throw err;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }

    // Have *anything*? Serve it. Do not make a visitor wait on Postgres
    // because the 2-minute TTL elapsed.
    if (hit) return { data: hit.data, stale: true };

    const data = await inflight.get(key);
    const latest = mem.get(key);
    if (latest) return { data: latest.data, stale: Date.now() - latest.ts >= ttlMs };
    if (data != null) return { data, stale: false };
    throw new Error('unavailable');
  }

  return { peek, put, resolve, _mem: mem };
}

module.exports = { createStaleStore };
