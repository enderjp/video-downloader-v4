import puppeteer from "puppeteer";
import fs from "fs";
import { execSync } from "child_process";
import path from "path";
import {
  FacebookAccessError,
  ScraperError,
  VideoNotFoundError,
} from "../errors.js";
import { config } from "../config.js";
import { loadFacebookCookies } from "../utils/loadCookies.js";
import { persistDebugArtifacts } from "../utils/debugArtifacts.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MP4_URL_PATTERN = /.mp4(?:\?|$)/i;
const MAX_NETWORK_CANDIDATES = 10;
const PLAYABLE_URL_REGEX = new RegExp(
  '"(?:browser_native(?:_(?:sd|hd))?|playable|progressive)_url(?:_quality_hd)?":"(https?:\\/\\/[^"]+)"',
  "g",
);
const DASH_BASE_URL_REGEX = new RegExp(
  '"base_url":"(https?:\\/\\/[^"]+)"',
  "g",
);
const XML_BASE_URL_REGEX = new RegExp(
  '<BaseURL>(https?:\\/\\/[^<]+)<\\/BaseURL>',
  "gi",
);
const GENERIC_ESCAPED_MP4_REGEX = new RegExp(
  '(https?:\\/\\/[^"\\s]+\\.mp4[^"\\s]*)',
  "gi",
);
const INLINE_CANDIDATE_REGEXES = [
  PLAYABLE_URL_REGEX,
  DASH_BASE_URL_REGEX,
  XML_BASE_URL_REGEX,
  GENERIC_ESCAPED_MP4_REGEX,
].map((regex) => ({ source: regex.source, flags: regex.flags }));

const buildFacebookUrlVariants = (rawUrl) => {
  const variants = [];
  const pushUnique = (value) => {
    if (!variants.includes(value)) {
      variants.push(value);
    }
  };

  const baseUrl = new URL(rawUrl);
  pushUnique(baseUrl.toString());

  const altHosts = [
    "www.facebook.com",
    "m.facebook.com",
    "mbasic.facebook.com",
    "web.facebook.com",
  ];

  if (baseUrl.hostname.endsWith("facebook.com")) {
    for (const host of altHosts) {
      const clone = new URL(baseUrl.toString());
      clone.hostname = host;
      pushUnique(clone.toString());
    }
  }

  const videoIdMatch =
    baseUrl.pathname.match(/\/videos\/([0-9]+)/) ||
    baseUrl.searchParams.get("v") ||
    null;
  const videoId = Array.isArray(videoIdMatch)
    ? videoIdMatch[1]
    : typeof videoIdMatch === "string"
      ? videoIdMatch
      : null;

  if (videoId) {
    for (const host of altHosts) {
      const watchUrl = new URL(`https://${host}/watch/`);
      watchUrl.searchParams.set("v", videoId);
      pushUnique(watchUrl.toString());
    }
  }

  return variants;
};

const buildCookieHeader = (cookies) =>
  Array.isArray(cookies) && cookies.length
    ? cookies.map(({ name, value }) => `${name}=${value}`).join("; ")
    : null;

const tryHttpFallbackExtraction = async (urls, { headers }) => {
  if (!Array.isArray(urls) || !urls.length) {
    return null;
  }
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
      });
      if (!response.ok) {
        continue;
      }
      const html = await response.text();
      const candidates = parsePlayableUrlsFromText(html)
        .map(normalizeCandidateUrl)
        .filter(Boolean);
      if (candidates.length) {
        console.warn(
          `HTTP fallback located ${candidates.length} candidates for ${url}`,
        );
        return { url, htmlContent: html, candidates };
      }
    } catch (error) {
      console.warn(
        `HTTP fallback request failed for ${url}:`,
        error?.message ?? error,
      );
    }
  }
  return null;
};

const decodeUnicodeSequences = (value) =>
  typeof value === "string"
    ? value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
    : "";

const decodeJsonEscapes = (value) =>
  decodeUnicodeSequences(value)
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'");

const normalizeCandidateUrl = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  let output = value.trim();
  if (!output) {
    return null;
  }
  output = decodeJsonEscapes(output)
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&amp;/gi, "&");
  try {
    output = decodeURIComponent(output);
  } catch {
    // Ignore malformed percent-encoded sequences.
  }
  if (!/^https?:\/\//i.test(output)) {
    return null;
  }
  return output;
};

const parsePlayableUrlsFromText = (payload) => {
  if (!payload || typeof payload !== "string") {
    return [];
  }
  const decodedPayload = decodeJsonEscapes(payload);
  const patterns = [
    PLAYABLE_URL_REGEX,
    DASH_BASE_URL_REGEX,
    XML_BASE_URL_REGEX,
    GENERIC_ESCAPED_MP4_REGEX,
  ];
  const matches = new Set();
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(decodedPayload)) !== null) {
      matches.add(match[1]);
    }
  }
  return Array.from(matches);
};

const watchNetworkForVideoUrls = (page) => {
  const queue = [];
  const seen = new Set();

  const addCandidate = (rawValue) => {
    const normalized = normalizeCandidateUrl(rawValue);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    queue.push(normalized);
    if (queue.length > MAX_NETWORK_CANDIDATES) {
      const removed = queue.shift();
      if (removed) {
        seen.delete(removed);
      }
    }
  };

  const handler = async (response) => {
    try {
      const requestUrl = response.url();
      if (requestUrl && MP4_URL_PATTERN.test(requestUrl)) {
        addCandidate(requestUrl);
        return;
      }
      const contentType = response.headers()["content-type"] ?? "";
      if (
        !contentType.includes("application/json") &&
        !contentType.includes("text/plain") &&
        !(requestUrl && requestUrl.includes("graphql"))
      ) {
        return;
      }
      const body = await response.text();
      parsePlayableUrlsFromText(body).forEach(addCandidate);
    } catch {
      // Ignore per-response parsing failures.
    }
  };

  page.on("response", handler);

  return {
    next: () => queue[queue.length - 1] ?? null,
    all: () => [...queue],
    stop: () => {
      if (typeof page.off === "function") {
        page.off("response", handler);
      } else {
        page.removeListener("response", handler);
      }
    },
  };
};

const extractInlineVideoUrls = async (page) =>
  page.evaluate((serializedRegexes) => {
    const urls = new Set();
    const patterns = serializedRegexes.map(
      ({ source, flags }) => new RegExp(source, flags),
    );
    for (const script of Array.from(document.scripts)) {
      const text = script?.textContent;
      if (!text) {
        continue;
      }
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          urls.add(match[1]);
        }
      }
    }
    return Array.from(urls);
  }, INLINE_CANDIDATE_REGEXES);

const OG_VIDEO_SELECTORS = [
  'meta[property="og:video:url"]',
  'meta[property="og:video:secure_url"]',
  'meta[property="og:video"]',
];

const OG_IMAGE_SELECTOR = 'meta[property="og:image"]';
const OG_TITLE_SELECTOR = 'meta[property="og:title"]';
const OG_DESCRIPTION_SELECTOR = 'meta[property="og:description"]';

const BLOCKED_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

const SUPPORTED_HOSTS = ["facebook.com", "fb.watch", "fb.com"];

const normalizeFacebookUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  const hostAllowed = SUPPORTED_HOSTS.some((host) => url.hostname.endsWith(host));
  if (!hostAllowed) {
    throw new ScraperError("Only Facebook URLs are supported.", {
      code: "UNSUPPORTED_HOST",
    });
  }
  if (url.protocol !== "https:") {
    url.protocol = "https:";
  }
  return url.toString();
};

const extractMetadata = async (page) =>
  page.evaluate(
    (
      imageSelector,
      titleSelector,
      descriptionSelector,
      requestedUrl,
    ) => {
      const safeContent = (selector) =>
        document.querySelector(selector)?.getAttribute("content") ?? null;

      return {
        title: safeContent(titleSelector),
        description: safeContent(descriptionSelector),
        thumbnail: safeContent(imageSelector),
        permalink: requestedUrl,
      };
    },
    OG_IMAGE_SELECTOR,
    OG_TITLE_SELECTOR,
    OG_DESCRIPTION_SELECTOR,
    page.url(),
  );

const readVideoUrl = async (page) => {
  const ogMatch = await page.evaluate((selectors) => {
    const findContent = (selectorList) => {
      for (const selector of selectorList) {
        const content = document
          .querySelector(selector)
          ?.getAttribute("content");
        if (content) {
          return content;
        }
      }
      return null;
    };

    return findContent(selectors);
  }, OG_VIDEO_SELECTORS);

  if (ogMatch) {
    return ogMatch;
  }

  return page.evaluate(() => {
    const video = document.querySelector("video");
    if (!video) {
      return null;
    }
    if (video.src) {
      return video.src;
    }
    const preferredSource = Array.from(video.querySelectorAll("source")).find(
      (node) => node.getAttribute("src")?.startsWith("http"),
    );
    return preferredSource?.getAttribute("src") ?? null;
  });
};

export const extractVideoSource = async (rawUrl, options = {}) => {
  const targetUrl = normalizeFacebookUrl(rawUrl);
  const urlVariants = buildFacebookUrlVariants(targetUrl);
  // Attempt to locate a Chrome/Chromium executable from environment or common locations.
  const resolveExecutable = () => {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    console.warn("PUPPETEER_EXECUTABLE_PATH:", envPath ?? "(not set)");
    if (envPath && fs.existsSync(envPath)) return envPath;

    const cacheDir = process.env.PUPPETEER_CACHE_DIR || process.env.PUPPETEER_CACHE || "/opt/render/.cache/puppeteer";
    console.warn("PUPPETEER_CACHE_DIR resolving to:", cacheDir);
    const candidates = [
      // common system paths
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      // puppeteer cache layout possibilities
      path.join(cacheDir, "chrome-linux", "chrome"),
      path.join(cacheDir, "chrome-linux-127.0.6533.88", "chrome"),
      path.join(cacheDir, "chrome-linux-127.0.6533-88", "chrome"),
      path.join(cacheDir, "chromium", "chrome"),
      // Render's default reported cache
      path.join("/opt/render/.cache/puppeteer", "chrome-linux", "chrome"),
    ];

    for (const p of candidates) {
      try {
        const exists = p && fs.existsSync(p);
        console.warn(`candidate: ${p} exists=${exists}`);
        if (exists) return p;
      } catch {
        // ignore
      }
    }

    // If nothing found, attempt to list top-level entries in cache dir to aid debugging (limited)
    try {
      if (cacheDir && fs.existsSync(cacheDir)) {
        const entries = fs.readdirSync(cacheDir).slice(0, 20);
        console.warn(`puppeteer cache dir contents (${cacheDir}):`, entries);
      } else if (fs.existsSync("/opt/render/.cache/puppeteer")) {
        const entries = fs.readdirSync("/opt/render/.cache/puppeteer").slice(0, 20);
        console.warn("/opt/render/.cache/puppeteer contents:", entries);
      } else {
        console.warn("puppeteer cache dir does not exist or is not readable");
      }
    } catch (err) {
      console.warn("error listing puppeteer cache dir:", err?.message ?? err);
    }

    // If nothing found, attempt to install Chromium into the resolved cache dir once
    try {
      // Respect an opt-out env var so we don't attempt installs when undesired
      if (!process.env.SKIP_PUPPETEER_INSTALL && cacheDir) {
        console.warn(`Attempting runtime puppeteer install into cache dir: ${cacheDir}`);
        const installEnv = { ...process.env, PUPPETEER_CACHE_DIR: cacheDir };
        try {
          const out = execSync("npx puppeteer@latest install chrome", {
            env: installEnv,
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 10 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
          }).toString();
          console.warn("puppeteer install output:", out.slice(0, 2000));
        } catch (installErr) {
          console.warn("puppeteer runtime install failed:", installErr?.message ?? installErr);
        }

        // Re-check candidates after attempted install
        for (const p of candidates) {
          try {
            const exists2 = p && fs.existsSync(p);
            console.warn(`post-install candidate: ${p} exists=${exists2}`);
            if (exists2) return p;
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      console.warn("error during runtime puppeteer install attempt:", err?.message ?? err);
    }

    return null;
  };

  const executablePath = resolveExecutable();

  const launchOptions = {
    headless: config.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
    console.warn(`Using Chrome executable at ${executablePath}`);
  }

  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(options.timeoutMs ?? config.navigationTimeoutMs);

  await page.setUserAgent(config.userAgent);
  await page.setExtraHTTPHeaders({
    "Accept-Language": options.locale ?? config.defaultLocale,
  });

  const networkWatcher = watchNetworkForVideoUrls(page);

  if (config.blockHeavyAssets) {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        request.abort();
        return;
      }
      request.continue();
    });
  }

  try {
    const cookies = await loadFacebookCookies(config.cookiesFilePath);
    if (cookies.length) {
      await page.setCookie(...cookies);
    }
    const cookieHeader = buildCookieHeader(cookies);

    const aggregatedInlineCandidates = new Set();
    const aggregatedHtmlCandidates = new Set();
    const aggregatedScriptCandidates = new Set();
    let networkCandidates = [];
    let domCandidate = null;
    let videoSource = null;
    let lastAttemptDetails = null;
    let lastPageHtml = "";

    for (const attemptUrl of urlVariants) {
      try {
        console.warn(`Attempting Facebook scrape at ${attemptUrl}`);
        await page.goto(attemptUrl, { waitUntil: "networkidle2" });
      } catch (navError) {
        console.warn(
          `Navigation failed for ${attemptUrl}:`,
          navError?.message ?? navError,
        );
        continue;
      }

      await page.waitForSelector("video", { timeout: 8000 }).catch(() => null);
      await delay(1500);

      const domCandidateForAttempt = normalizeCandidateUrl(await readVideoUrl(page));
      if (!domCandidate && domCandidateForAttempt) {
        domCandidate = domCandidateForAttempt;
      }

      const scriptCandidatesForAttempt = (await extractInlineVideoUrls(page))
        .map(normalizeCandidateUrl)
        .filter(Boolean);
      const pageHtml = await page.content();
      const htmlCandidatesForAttempt = parsePlayableUrlsFromText(pageHtml)
        .map(normalizeCandidateUrl)
        .filter(Boolean);
      const inlineCandidatesForAttempt = Array.from(
        new Set([...scriptCandidatesForAttempt, ...htmlCandidatesForAttempt]),
      );

      scriptCandidatesForAttempt.forEach((value) =>
        aggregatedScriptCandidates.add(value),
      );
      htmlCandidatesForAttempt.forEach((value) =>
        aggregatedHtmlCandidates.add(value),
      );
      inlineCandidatesForAttempt.forEach((value) =>
        aggregatedInlineCandidates.add(value),
      );

      lastPageHtml = pageHtml;
      lastAttemptDetails = {
        scriptCandidates: scriptCandidatesForAttempt,
        htmlCandidates: htmlCandidatesForAttempt,
        inlineCandidates: inlineCandidatesForAttempt,
        htmlContent: pageHtml,
        attemptedUrl: attemptUrl,
      };

      const networkCandidate = networkWatcher.next();
      const attemptVideoSource =
        domCandidateForAttempt ?? inlineCandidatesForAttempt[0] ?? networkCandidate;
      if (attemptVideoSource) {
        videoSource = attemptVideoSource;
        break;
      }
    }

    networkCandidates = networkWatcher.all();
    let inlineCandidates = Array.from(aggregatedInlineCandidates);
    let htmlCandidates = Array.from(aggregatedHtmlCandidates);
    let scriptCandidates = Array.from(aggregatedScriptCandidates);
    let candidateUrls = Array.from(
      new Set(
        [domCandidate, ...inlineCandidates, ...networkCandidates].filter(Boolean),
      ),
    );

    if (!videoSource && cookieHeader) {
      const httpHeaders = {
        "User-Agent": config.userAgent,
        "Accept-Language": options.locale ?? config.defaultLocale,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        Cookie: cookieHeader,
      };
      const httpFallback = await tryHttpFallbackExtraction(urlVariants, {
        headers: httpHeaders,
      });
      if (httpFallback?.candidates?.length) {
        httpFallback.candidates.forEach((candidate) => {
          aggregatedInlineCandidates.add(candidate);
          aggregatedHtmlCandidates.add(candidate);
        });
        inlineCandidates = Array.from(aggregatedInlineCandidates);
        htmlCandidates = Array.from(aggregatedHtmlCandidates);
        scriptCandidates = Array.from(aggregatedScriptCandidates);
        candidateUrls = Array.from(
          new Set(
            [domCandidate, ...inlineCandidates, ...networkCandidates].filter(Boolean),
          ),
        );
        videoSource = httpFallback.candidates[0];
        lastPageHtml = httpFallback.htmlContent;
        lastAttemptDetails = {
          scriptCandidates,
          htmlCandidates: httpFallback.candidates,
          inlineCandidates: httpFallback.candidates,
          htmlContent: httpFallback.htmlContent,
          attemptedUrl: httpFallback.url,
        };
      }
    }

    const candidateSummary = {
      dom: domCandidate,
      inline: inlineCandidates,
      network: networkCandidates,
      all: candidateUrls,
    };

    if (!videoSource) {
      let debugArtifacts = null;
      if (config.enableDebugSnapshots) {
        try {
          const artifacts = await persistDebugArtifacts({
            page,
            requestedUrl: targetUrl,
            scriptCandidates: lastAttemptDetails?.scriptCandidates ?? [],
            htmlCandidates: lastAttemptDetails?.htmlCandidates ?? [],
            inlineCandidates: lastAttemptDetails?.inlineCandidates ?? [],
            networkCandidates,
            htmlContent: lastAttemptDetails?.htmlContent ?? lastPageHtml,
            dir: config.debugSnapshotsDir,
          });
          debugArtifacts = artifacts;
          console.warn(
            `Saved Facebook debug snapshot to ${artifacts.htmlPath} and ${artifacts.metaPath}`,
          );
        } catch (snapshotError) {
          console.error("Failed to persist Facebook debug snapshot", snapshotError);
        }
      }
      throw new VideoNotFoundError(undefined, {
        candidates: candidateSummary,
        debugArtifacts,
      });
    }

    const metadata = options.fetchMetadata === false ? null : await extractMetadata(page);

    return {
      requestedUrl: targetUrl,
      sourceUrl: videoSource,
      metadata,
      fetchedAt: new Date().toISOString(),
      candidates: candidateSummary,
    };
  } catch (error) {
    if (error instanceof ScraperError) {
      throw error;
    }
    if (error.message?.includes("ERR_BLOCKED_BY_RESPONSE")) {
      throw new FacebookAccessError("Facebook blocked the automated request.");
    }
    if (error.name === "TimeoutError") {
      throw new FacebookAccessError("Timed out while loading the Facebook post.");
    }
    throw new ScraperError(error.message);
  } finally {
    networkWatcher.stop();
    await browser.close();
  }
};
