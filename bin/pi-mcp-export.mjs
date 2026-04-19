#!/usr/bin/env node
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
const jiti = createJiti(import.meta.url, {
  alias: { "@": srcRoot.replace(/\/$/, "") },
});
const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
await jiti.import(cliPath, { default: true });
