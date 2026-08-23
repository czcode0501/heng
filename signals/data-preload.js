export function isSignalPayloadFresh(payload, nowMs = Date.now()) {
  const generatedAt = Date.parse(payload?.generatedAt || "");
  const refreshAfterSeconds = Number(payload?.refreshAfterSeconds);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(refreshAfterSeconds) || refreshAfterSeconds <= 0) return false;
  const age = nowMs - generatedAt;
  return age >= 0 && age < refreshAfterSeconds * 1000;
}

export function createSignalPreloader(fetchImplementation = globalThis.fetch) {
  let payload = null;
  let request = null;

  async function load() {
    if (payload) return payload;
    if (request) return request;
    request = (async () => {
      const response = await fetchImplementation("/api/signals");
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "信号数据预加载失败");
      if (!body?.data?.preloaded || !body.data.workspaces) throw new Error("信号数据预加载格式不正确");
      payload = body.data;
      return payload;
    })();
    try {
      return await request;
    } finally {
      request = null;
    }
  }

  return {
    load,
    async getWorkspace(id) {
      return (await load()).workspaces?.[id] ?? null;
    },
    isReady() {
      return payload !== null;
    },
  };
}
