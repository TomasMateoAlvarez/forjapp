import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDocument } from "./openapi/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "openapi.json");

const document = generateDocument();
writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n");
console.log(`OpenAPI spec generado en ${path.relative(process.cwd(), outPath)}`);
