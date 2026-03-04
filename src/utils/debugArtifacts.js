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
  scriptCandidates,
  htmlCandidates,
  htmlContent,
  dir,
}) => {
  const targetDir = resolveDir(dir ?? "snapshots");
  await ensureDir(targetDir);
  const slug = `${timestampSlug()}-video-not-found`;
  const htmlPath = path.join(targetDir, `${slug}.html`);
  const metaPath = path.join(targetDir, `${slug}.json`);

  const [htmlSnapshot, pageUrl] = await Promise.all([
    htmlContent ?? page.content(),
    page.url(),
  ]);

  await fs.writeFile(htmlPath, htmlSnapshot, "utf-8");
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        requestedUrl,
        pageUrl,
        inlineCandidates,
        scriptCandidates,
        htmlCandidates,
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
