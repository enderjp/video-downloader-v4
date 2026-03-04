export class ScraperError extends Error {
  constructor(message, { code = "SCRAPER_ERROR", meta } = {}) {
    super(message);
    this.name = "ScraperError";
    this.code = code;
    this.meta = meta;
  }
}

export class FacebookAccessError extends ScraperError {
  constructor(message = "Facebook rejected the request", meta) {
    super(message, { code: "FACEBOOK_ACCESS_ERROR", meta });
    this.name = "FacebookAccessError";
  }
}

export class VideoNotFoundError extends ScraperError {
  constructor(
    message = "Unable to locate a playable video for this post.",
    meta,
  ) {
    super(message, { code: "VIDEO_NOT_FOUND", meta });
    this.name = "VideoNotFoundError";
  }
}
