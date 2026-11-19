// Copy the shared reference tables from the Python package into the website.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../src/windowseat/data");
const dst = join(here, "../public/data");
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (f.endsWith(".csv")) cpSync(join(src, f), join(dst, f));
console.log(`copied reference data → public/data`);
