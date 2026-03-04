import puppeteer from "puppeteer";
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
  const browser = await puppeteer.launch({
    headless: config.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

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

    await page.goto(targetUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("video", { timeout: 8000 }).catch(() => null);
    await delay(2000);

    const domCandidate = normalizeCandidateUrl(await readVideoUrl(page));
    const scriptCandidates = (await extractInlineVideoUrls(page))
      .map(normalizeCandidateUrl)
      .filter(Boolean);
    const pageHtml = await page.content();
    const htmlCandidates = parsePlayableUrlsFromText(pageHtml)
      .map(normalizeCandidateUrl)
      .filter(Boolean);
    const inlineCandidates = Array.from(
      new Set([...scriptCandidates, ...htmlCandidates]),
    );
    const networkCandidate = networkWatcher.next();
    const networkCandidates = networkWatcher.all();

    const videoSource = domCandidate ?? inlineCandidates[0] ?? networkCandidate;
    const candidateUrls = Array.from(
      new Set(
        [domCandidate, ...inlineCandidates, ...networkCandidates].filter(Boolean),
      ),
    );
    const candidateSummary = {
      dom: domCandidate,
      inline: inlineCandidates,
      network: networkCandidates,
      all: candidateUrls,
    };
    let debugArtifacts = null;

    if (!videoSource) {
      if (config.enableDebugSnapshots) {
        try {
          const artifacts = await persistDebugArtifacts({
            page,
            requestedUrl: targetUrl,
            scriptCandidates,
            htmlCandidates,
            inlineCandidates,
            networkCandidates,
            htmlContent: pageHtml,
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
