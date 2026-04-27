const buildCookieFromLine = (line) => {
  const parts = line.split("\t");
  if (parts.length < 7) {
    return {
      cookie: null,
      error: "Line must contain at least 7 tab-separated fields.",
    };
  }

  const [domain, , cookiePath, secureFlag, expiresRaw, name, ...valueParts] = parts;
  const value = valueParts.join("\t");

  if (!domain || !name || typeof value === "undefined") {
    return {
      cookie: null,
      error: "Line is missing required domain/name/value fields.",
    };
  }

  const expires = Number(expiresRaw);
  return {
    cookie: {
      domain,
      path: cookiePath || "/",
      secure: secureFlag?.toUpperCase() === "TRUE",
      expires: Number.isFinite(expires) && expires > 0 ? expires : undefined,
      name,
      value,
      httpOnly: false,
    },
    error: null,
  };
};

export const parseNetscapeCookieText = (raw, { strict = false } = {}) => {
  const text = typeof raw === "string" ? raw : "";
  const cookies = [];
  const invalidLines = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const { cookie, error } = buildCookieFromLine(line);
    if (!cookie) {
      invalidLines.push({
        line: i + 1,
        reason: error,
      });
      continue;
    }
    cookies.push(cookie);
  }

  if (strict && invalidLines.length) {
    const error = new Error("Invalid Netscape cookie file format.");
    error.code = "COOKIE_FILE_INVALID";
    error.meta = {
      invalidLines: invalidLines.slice(0, 20),
      invalidCount: invalidLines.length,
    };
    throw error;
  }

  return { cookies, invalidLines };
};
