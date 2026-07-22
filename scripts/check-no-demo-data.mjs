import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const productRoots = ["app", "components", "lib"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const prohibited = [
  /\bmockData\b/i,
  /\bdemoData\b/i,
  /\bsampleProjects?\b/i,
  /\bfakeResponse\b/i,
  /workspace preview/i,
  /does not save data/i,
  /video placeholder/i,
  /4\.9\/5[^\n]{0,80}4268 students/i,
  /trusted by students from universities/i,
  /REQUIREMENTS FOUND/i,
  /EC[–-]014/i,
  /Leadership autonomy and performance/i,
  /2 of 8 confirmed/i,
  /6 items confirmed/i,
  /2,000 words allocated/i,
  /3 evidence cards/i,
  /Critical analysis · 30%/i,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : sourceExtensions.has(extname(path)) ? [path] : [];
  }));
  return files.flat();
}

const violations = [];
for (const root of productRoots) {
  for (const file of await sourceFiles(root)) {
    const content = await readFile(file, "utf8");
    for (const pattern of prohibited) {
      if (pattern.test(content)) violations.push(`${relative(process.cwd(), file)} matches ${pattern}`);
    }
  }
}

if (violations.length) {
  console.error("Demo or mock product data is prohibited:\n" + violations.join("\n"));
  process.exit(1);
}

console.log("Product code contains no known demo-data or fabricated-proof patterns.");
