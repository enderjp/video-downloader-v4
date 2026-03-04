import path from "path";
import { promises as fs } from "fs";

const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, "-");

const resolveDir = (dirPath) =>
  path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const persistDebugArtifacts = async ({
  page,
  requestedUrl,
  inlineCandidates,
  networkCandidates,
  dir,
}) => {
  const targetDir = resolveDir(dir ?? "snapshots");
  await ensureDir(targetDir);
  const slug = `${timestampSlug()}-video-not-found`;
  const htmlPath = path.join(targetDir, `${slug}.html`);
  const metaPath = path.join(targetDir, `${slug}.json`);

  const [htmlContent, pageUrl] = await Promise.all([
    page.content(),
    page.url(),
  ]);

  await fs.writeFile(htmlPath, htmlContent, "utf-8");
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        requestedUrl,
        pageUrl,
        inlineCandidates,
        networkCandidates,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  return { htmlPath, metaPath };
};
