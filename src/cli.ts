#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { generateFromOpenAPI } from "./index"

const program = new Command();

program
  .command("generate")
  .requiredOption("-i, --input <file>", "OpenAPI JSON file")
  .requiredOption("-o, --output <dir>", "Output directory")
  .action(async (opts: any) => {
    const files = await generateFromOpenAPI(opts.input);

    if (!fs.existsSync(opts.output)) fs.mkdirSync(opts.output, { recursive: true });

    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(opts.output, name);
      fs.writeFileSync(filePath, content as string, "utf-8");
      console.log(`Generated ${filePath}`);
    }
  });

program.parse(process.argv);