export function perf(label: string) {
  const start = process.hrtime.bigint();
  return {
    end(extra?: Record<string, any>) {
      const end = process.hrtime.bigint();
      const ms = Number(end - start) / 1_000_000;
      const payload = extra ? ` | ${JSON.stringify(extra)}` : '';
      console.log(`⏱️ PERF | ${label} | ${ms.toFixed(1)} ms${payload}`);
      return ms;
    },
  };
}
