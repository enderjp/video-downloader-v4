import path from "path";
import { promises as fs } from "fs";
import { ScraperError } from "../errors.js";

const netscapeLineToCookie = (line) => {
  const parts = line.split(/\t/);
  if (parts.length < 7) {
    return null;
  }
  const [domain, , cookiePath, secureFlag, expiresRaw, name, ...valueParts] = parts;
  const value = valueParts.join("\t");
  if (!name || typeof value === "undefined") {
    return null;
  }
  const expires = Number(expiresRaw);
  return {
    domain,
    path: cookiePath || "/",
    secure: secureFlag?.toUpperCase() === "TRUE",
    expires: Number.isFinite(expires) && expires > 0 ? expires : undefined,
    name,
    value,
    httpOnly: false,
  };
};

let cache = {
  path: null,
  mtimeMs: 0,
  cookies: [],
};

export const loadFacebookCookies = async (filePath) => {
  if (!filePath) {
    return [];
  }
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch (error) {
    throw new ScraperError(`Cookie file not found at ${absolutePath}`, {
      code: "COOKIE_FILE_NOT_FOUND",
      meta: { error: error.message },
    });
  }

  if (cache.path === absolutePath && cache.mtimeMs === stats.mtimeMs) {
    return cache.cookies;
  }

  const raw = await fs.readFile(absolutePath, "utf-8");
  const cookies = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(netscapeLineToCookie)
    .filter(Boolean);

  if (!cookies.length) {
    throw new ScraperError("No cookies were parsed from the provided file.", {
      code: "COOKIE_FILE_EMPTY",
    });
  }

  cache = {
    path: absolutePath,
    mtimeMs: stats.mtimeMs,
    cookies,
  };

  return cookies;
};
