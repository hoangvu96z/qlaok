import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT_DIR = process.cwd();

function tryResolveTsFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return pathToFileURL(c).href;
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Resolve Next.js "@/..." alias to "<root>/src/..."
    if (specifier.startsWith('@/')) {
      const target = path.join(ROOT_DIR, 'src', specifier.slice(2));
      const resolvedUrl = tryResolveTsFile(target);
      if (resolvedUrl) {
        return { url: resolvedUrl, shortCircuit: true };
      }
    }

    // Resolve extensionless relative imports (.ts / .tsx) inside project files
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL &&
      !context.parentURL.includes('node_modules')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = path.resolve(parentDir, specifier);
      const resolvedUrl = tryResolveTsFile(target);
      if (resolvedUrl) {
        return { url: resolvedUrl, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
