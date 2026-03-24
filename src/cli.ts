#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { generateFromOpenAPI } from "./index";

const program = new Command();

program
	.command("generate")
	.description("Generate TypeScript API client code from an OpenAPI JSON file.")
	.addHelpText(
		"after",
		"\nExamples:\n  api-geno generate --input api.json --output generated --error-style both --http-adapter fetch\n\nOptions:\n  --output-format ts    Output format, currently only 'ts' is supported.\n  --http-adapter       Select axios or fetch implementation (default axios).\n  --skip-generated-outputs  Print generated code to console instead of writing files.\n  --force              Regenerate even when input+options hash is unchanged.\n",
	)
	.requiredOption("-i, --input <file>", "OpenAPI JSON file")
	.requiredOption("-o, --output <dir>", "Output directory")
	.option(
		"--error-style <style>",
		"Error emission style: 'class' | 'shape' | 'both'",
		"both",
	)
	.option(
		"--emit-only-shapes",
		"Shortcut to emit only shape interfaces (sets --error-style=shape)",
	)
	.option("--skip-generated-outputs", "Do not write generated files to disk")
	.option(
		"--force",
		"Force regeneration even if input and options did not change",
	)
	.option(
		"--output-format <fmt>",
		"Output format (ts|esm). Currently ts only",
		"ts",
	)
	.option(
		"--http-adapter <adapter>",
		"Http adapter to generate (axios|fetch)",
		"axios",
	)
	.action(async (opts: any, cmd: any) => {
		const options = typeof cmd?.opts === "function" ? cmd.opts() : opts;
		const outputDir = path.resolve(options.output || options.out);
		const inputFile = path.resolve(options.input || options.in);

		if (!inputFile) {
			throw new Error("Missing input file; use --input <file>");
		}

		if (!outputDir) {
			throw new Error("Missing output directory; use --output <dir>");
		}

		if (!fs.existsSync(inputFile)) {
			throw new Error(`Input file does not exist: ${inputFile}`);
		}

		const errorStyle = options.emitOnlyShapes
			? "shape"
			: options.errorStyle || "both";
		const outputFormat = options.outputFormat || "ts";
		const httpAdapter = options.httpAdapter || "axios";
		const skipGeneratedOutputs = !!options.skipGeneratedOutputs;
		const forceRegen = !!options.force;

		if (outputFormat !== "ts") {
			throw new Error("Unsupported --output-format: currently only 'ts' is supported");
		}

		if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

		// simple cache: store hash of input + options to avoid unnecessary work
		const crypto = await import("crypto");
		const inputData = fs.readFileSync(inputFile, "utf8");
		const hash = crypto
			.createHash("sha256")
			.update(
				inputData +
				JSON.stringify({
					errorStyle,
					outputFormat,
					httpAdapter,
					emitOnlyShapes: !!options.emitOnlyShapes,
					skipGeneratedOutputs,
				}),
			)
			.digest("hex");
		const hashPath = path.join(outputDir, ".api-geno.hash");
		let previousHash: string | null = null;
		if (fs.existsSync(hashPath))
			previousHash = fs.readFileSync(hashPath, "utf8");

		if (!forceRegen && previousHash === hash) {
			console.log(
				"No changes detected in API + options — skipping generation.",
			);
			return;
		}

		const generationOptions = {
			errorStyle,
			outputFormat,
			httpAdapter,
		};

		const files = generateFromOpenAPI(inputFile, [], generationOptions);

		if (skipGeneratedOutputs) {
			// print files to console for inspection
			for (const [name, content] of Object.entries(files)) {
				console.log(`--- ${name} ---`);
				console.log(content as string);
			}
			fs.writeFileSync(hashPath, hash, "utf8");
			console.log("Skip generated outputs enabled; cache hash updated.");
			return;
		}

		for (const [name, content] of Object.entries(files)) {
			const filePath = path.join(outputDir, name);
			const dir = path.dirname(filePath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(filePath, content as string, "utf-8");
		}

		fs.writeFileSync(hashPath, hash, "utf8");
	});

program.parse(process.argv);
