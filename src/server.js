import express from "express";
import swaggerUi from "swagger-ui-express";
import { config } from "./config.js";
import { extractPayloadSchema } from "./validators/extractSchema.js";
import {
  ScraperError,
  VideoNotFoundError,
} from "./errors.js";
import { extractVideoSource } from "./services/facebookScraper.js";
import { promises as fs } from "fs";
import { swaggerSpec } from "./docs/swagger.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

let activeExtractions = 0;

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    busy: activeExtractions > 0,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
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

app.listen(config.port, () => {
  console.log(`Facebook video extractor listening on port ${config.port}`);
});
