import { existsSync } from "node:fs";
import { extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolvePath(fileURLToPath(new URL("..", import.meta.url)));
const extensions = [".ts", ".tsx", ".mjs", ".js"];

function resolveWorkspaceFile(path) {
  if (extname(path) && existsSync(path)) return path;
  for (const extension of extensions) {
    if (existsSync(`${path}${extension}`)) return `${path}${extension}`;
  }
  for (const extension of extensions) {
    const indexPath = resolvePath(path, `index${extension}`);
    if (existsSync(indexPath)) return indexPath;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export%20{}", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const path = resolveWorkspaceFile(resolvePath(repositoryRoot, specifier.slice(2)));
    if (!path) throw new Error(`Cannot resolve workspace import ${specifier}.`);
    return { url: pathToFileURL(path).href, shortCircuit: true };
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../"))
    && context.parentURL?.startsWith("file:")
  ) {
    const path = resolveWorkspaceFile(resolvePath(fileURLToPath(new URL(".", context.parentURL)), specifier));
    if (path) return { url: pathToFileURL(path).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
