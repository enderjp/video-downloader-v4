const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: toNumber(process.env.PORT, 3000),
  defaultLocale: process.env.FACEBOOK_LOCALE ?? "en-US,en;q=0.9",
  navigationTimeoutMs: toNumber(process.env.PUPPETEER_TIMEOUT, 60000),
  headless: process.env.PUPPETEER_HEADLESS ?? "new",
  blockHeavyAssets: process.env.BLOCK_HEAVY_ASSETS !== "false",
  userAgent:
    process.env.PUPPETEER_USER_AGENT ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  cookiesFilePath: process.env.FACEBOOK_COOKIES_PATH ?? "cookies-file.txt",
  cookieAdminToken: process.env.COOKIE_ADMIN_TOKEN ?? "",
  cookieAdminMaxBytes: toNumber(process.env.COOKIE_ADMIN_MAX_BYTES, 1048576),
  cookieAuditLogPath:
    process.env.COOKIE_AUDIT_LOG_PATH ?? "snapshots/cookie-rotation.audit.jsonl",
  cookieAdminActorHeader: process.env.COOKIE_ADMIN_ACTOR_HEADER ?? "x-cookie-actor",
  enableDebugSnapshots: process.env.FACEBOOK_DEBUG_SNAPSHOTS !== "false",
  debugSnapshotsDir: process.env.FACEBOOK_DEBUG_DIR ?? "snapshots",
};
