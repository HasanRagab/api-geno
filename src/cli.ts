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
  .option('--error-style <style>', "Error emission style: 'class' | 'shape' | 'both'", 'both')
  .option('--emit-only-shapes', 'Shortcut to emit only shape interfaces (sets --error-style=shape)')
  .option('--skip-generated-outputs', 'Do not write generated files to disk')
  .option('--force', 'Force regeneration even if input and options did not change')
  .option('--output-format <fmt>', "Output format (ts|esm). Currently ts only", 'ts')
  .action(async (opts: any, cmd: any) => {
    const options = typeof cmd?.opts === 'function' ? cmd.opts() : opts;
    const outputDir = options.output || options.out;
    const inputFile = options.input || options.in;

    if (!inputFile) {
      throw new Error('Missing input file; use --input <file>');
    }

    if (!outputDir) {
      throw new Error('Missing output directory; use --output <dir>');
    }

    const errorStyle = options.emitOnlyShapes ? 'shape' : options.errorStyle || 'both';

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // simple cache: store hash of input + options to avoid unnecessary work
    const crypto = await import('crypto');
    const inputData = fs.readFileSync(inputFile, 'utf8');
    const hash = crypto.createHash('sha256').update(inputData + JSON.stringify({ errorStyle })).digest('hex');
    const hashPath = path.join(outputDir, '.api-geno.hash');
    let previousHash: string | null = null;
    if (fs.existsSync(hashPath)) previousHash = fs.readFileSync(hashPath, 'utf8');

    if (!opts.force && previousHash === hash) {
      console.log('No changes detected in API + options — skipping generation.');
      return;
    }

    const files = generateFromOpenAPI(opts.input, [], { errorStyle });

    if (opts.skipGeneratedOutputs) {
      // print files to console for inspection
      for (const [name, content] of Object.entries(files)) {
        console.log(`--- ${name} ---`);
        console.log(content as string);
      }
      return;
    }

    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(opts.output, name);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content as string, "utf-8");
    }

    fs.writeFileSync(hashPath, hash, 'utf8');
  });

program.parse(process.argv);