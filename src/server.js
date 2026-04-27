import express from "express";
import swaggerUi from "swagger-ui-express";
import { timingSafeEqual } from "crypto";
import { config } from "./config.js";
import { extractPayloadSchema } from "./validators/extractSchema.js";
import {
  ScraperError,
  VideoNotFoundError,
} from "./errors.js";
import { extractVideoSource } from "./services/facebookScraper.js";
import {
  appendCookieRotationAudit,
  replaceCookieFileAtomically,
} from "./services/cookieRotationService.js";
import { promises as fs } from "fs";
import { swaggerSpec } from "./docs/swagger.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

let activeExtractions = 0;

const parseBearerToken = (authorizationHeader) => {
  if (typeof authorizationHeader !== "string") {
    return null;
  }
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const tokenMatches = (expected, provided) => {
  if (!expected || !provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, "utf-8");
  const providedBuffer = Buffer.from(provided, "utf-8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
};

const appendAuditSafely = async (event) => {
  try {
    await appendCookieRotationAudit(config.cookieAuditLogPath, event);
  } catch (error) {
    console.error("Failed to append cookie rotation audit event", error);
  }
};

const cookieReplaceUploadParser = express.raw({
  type: ["text/plain", "application/octet-stream", "application/x-netscape-cookie"],
  limit: config.cookieAdminMaxBytes,
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    busy: activeExtractions > 0,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/admin/cookies/replace", cookieReplaceUploadParser, async (req, res) => {
  const now = new Date().toISOString();
  const actor = req.get(config.cookieAdminActorHeader) ?? "unknown";
  const auditBase = {
    timestamp: now,
    actor,
    route: req.path,
    remoteIp: req.ip ?? null,
  };

  if (!config.cookieAdminToken) {
    const code =
      config.nodeEnv === "production"
        ? "COOKIE_ADMIN_TOKEN_NOT_CONFIGURED"
        : "COOKIE_ADMIN_DISABLED";
    const statusCode = config.nodeEnv === "production" ? 503 : 501;
    await appendAuditSafely({
      ...auditBase,
      status: "rejected",
      code,
    });
    return res.status(statusCode).json({
      error:
        "Cookie admin endpoint is disabled because COOKIE_ADMIN_TOKEN is not configured.",
      code,
    });
  }

  const bearerToken = parseBearerToken(req.get("authorization"));
  if (!bearerToken) {
    await appendAuditSafely({
      ...auditBase,
      status: "rejected",
      code: "COOKIE_ADMIN_AUTH_MISSING",
    });
    return res.status(401).json({
      error: "Missing or invalid Authorization header.",
      code: "COOKIE_ADMIN_AUTH_MISSING",
    });
  }

  if (!tokenMatches(config.cookieAdminToken, bearerToken)) {
    await appendAuditSafely({
      ...auditBase,
      status: "rejected",
      code: "COOKIE_ADMIN_AUTH_INVALID",
    });
    return res.status(403).json({
      error: "Invalid admin token.",
      code: "COOKIE_ADMIN_AUTH_INVALID",
    });
  }

  try {
    const updateResult = await replaceCookieFileAtomically({
      cookieFilePath: config.cookiesFilePath,
      bodyBuffer: req.body,
      maxBytes: config.cookieAdminMaxBytes,
    });

    await appendAuditSafely({
      ...auditBase,
      status: "success",
      code: "COOKIE_ROTATION_SUCCESS",
      bytes: updateResult.bytes,
      cookiesParsed: updateResult.cookiesParsed,
      sha256: updateResult.sha256,
      updatedAt: updateResult.updatedAt,
      filePath: updateResult.filePath,
    });

    return res.json({
      ok: true,
      bytes: updateResult.bytes,
      cookiesParsed: updateResult.cookiesParsed,
      sha256: updateResult.sha256,
      updatedAt: updateResult.updatedAt,
    });
  } catch (error) {
    const statusCodeByCode = {
      COOKIE_FILE_EMPTY: 400,
      COOKIE_FILE_INVALID: 400,
      COOKIE_FILE_TOO_LARGE: 413,
      COOKIE_FILE_WRITE_FAILED: 500,
    };
    const statusCode = statusCodeByCode[error.code] ?? 500;

    await appendAuditSafely({
      ...auditBase,
      status: "error",
      code: error.code ?? "COOKIE_ROTATION_ERROR",
      bytes: Buffer.isBuffer(req.body) ? req.body.length : null,
      meta: error.meta ?? null,
    });

    return res.status(statusCode).json({
      error: error.message ?? "Failed to rotate cookie file.",
      code: error.code ?? "COOKIE_ROTATION_ERROR",
      meta: error.meta ?? null,
    });
  }
});

app.post("/api/extract", async (req, res) => {
  const parsed = extractPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: parsed.error.errors,
    });
  }

  const { url, options } = parsed.data;

  activeExtractions += 1;
  try {
    const payload = await extractVideoSource(url, options);
    return res.json(payload);
  } catch (error) {
    const tryRemoveArtifacts = async (meta) => {
      try {
        const htmlPath = meta?.debugArtifacts?.htmlPath;
        const metaPath = meta?.debugArtifacts?.metaPath;
        if (htmlPath) {
          await fs.unlink(htmlPath).catch(() => {});
        }
        if (metaPath) {
          await fs.unlink(metaPath).catch(() => {});
        }
      } catch {
        // ignore removal errors
      }
    };

    if (error instanceof VideoNotFoundError) {
      if (error.meta) await tryRemoveArtifacts(error.meta);
      return res.status(404).json({
        error: error.message,
        code: error.code,
        meta: error.meta ?? null,
      });
    }
    if (error instanceof ScraperError) {
      if (error.meta) await tryRemoveArtifacts(error.meta);
      return res.status(502).json({
        error: error.message,
        code: error.code,
        meta: error.meta ?? null,
      });
    }
    console.error("Unexpected error extracting video", error);
    return res.status(500).json({
      error: "Unexpected error extracting the video. Check the server logs.",
    });
  } finally {
    activeExtractions = Math.max(0, activeExtractions - 1);
  }
});

app.use(async (error, req, res, next) => {
  if (!error) {
    return next();
  }
  if (error.type === "entity.too.large") {
    if (req.path === "/api/admin/cookies/replace") {
      await appendAuditSafely({
        timestamp: new Date().toISOString(),
        actor: req.get(config.cookieAdminActorHeader) ?? "unknown",
        route: req.path,
        remoteIp: req.ip ?? null,
        status: "error",
        code: "COOKIE_FILE_TOO_LARGE",
      });
    }
    return res.status(413).json({
      error: "Payload too large.",
      code: "COOKIE_FILE_TOO_LARGE",
    });
  }

  console.error("Unhandled express error", error);
  return res.status(500).json({
    error: "Unexpected server error.",
    code: "INTERNAL_SERVER_ERROR",
  });
});

app.listen(config.port, () => {
  console.log(`Facebook video extractor listening on port ${config.port}`);
});
