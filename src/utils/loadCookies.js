import path from "path";
import { promises as fs } from "fs";
import { ScraperError } from "../errors.js";
import { parseNetscapeCookieText } from "./netscapeCookies.js";

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
  const { cookies } = parseNetscapeCookieText(raw);

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
