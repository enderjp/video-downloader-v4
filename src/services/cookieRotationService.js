import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { ScraperError } from "../errors.js";
import { parseNetscapeCookieText } from "../utils/netscapeCookies.js";

const resolvePath = (value) =>
  path.isAbsolute(value) ? value : path.join(process.cwd(), value);

export const appendCookieRotationAudit = async (auditPath, payload) => {
  const absoluteAuditPath = resolvePath(auditPath);
  await fs.mkdir(path.dirname(absoluteAuditPath), { recursive: true });
  await fs.appendFile(absoluteAuditPath, `${JSON.stringify(payload)}\n`, "utf-8");
};

export const replaceCookieFileAtomically = async ({
  cookieFilePath,
  bodyBuffer,
  maxBytes,
}) => {
  if (!Buffer.isBuffer(bodyBuffer) || bodyBuffer.length === 0) {
    throw new ScraperError("Cookie payload is empty.", {
      code: "COOKIE_FILE_EMPTY",
    });
  }

  if (bodyBuffer.length > maxBytes) {
    throw new ScraperError("Cookie payload exceeds the maximum allowed size.", {
      code: "COOKIE_FILE_TOO_LARGE",
      meta: {
        bytes: bodyBuffer.length,
        maxBytes,
      },
    });
  }

  const rawText = bodyBuffer.toString("utf-8");
  const { cookies, invalidLines } = parseNetscapeCookieText(rawText, { strict: true });
  if (!cookies.length) {
    throw new ScraperError("No cookies were parsed from the uploaded file.", {
      code: "COOKIE_FILE_EMPTY",
    });
  }

  const targetPath = resolvePath(cookieFilePath);
  const directory = path.dirname(targetPath);
  const tempPath = `${targetPath}.tmp-${Date.now()}-${process.pid}`;
  const sha256 = crypto.createHash("sha256").update(bodyBuffer).digest("hex");

  await fs.mkdir(directory, { recursive: true });

  try {
    await fs.writeFile(tempPath, rawText, { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tempPath, targetPath);
    await fs.chmod(targetPath, 0o600).catch(() => {});
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw new ScraperError("Failed to replace cookie file.", {
      code: "COOKIE_FILE_WRITE_FAILED",
      meta: { error: error.message },
    });
  }

  return {
    filePath: targetPath,
    bytes: bodyBuffer.length,
    cookiesParsed: cookies.length,
    invalidLines,
    sha256,
    updatedAt: new Date().toISOString(),
  };
};
