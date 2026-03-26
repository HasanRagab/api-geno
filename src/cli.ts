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
	.option("-w, --watch", "Watch input file for changes and regenerate")
	.action(async (opts: any, cmd: any) => {
		const options = typeof cmd?.opts === "function" ? cmd.opts() : opts;

		const runGeneration = async () => {
			// Load from config file if exists
			const configPath = path.resolve("api-geno.config.json");
			let fileConfig: any = {};
			if (fs.existsSync(configPath)) {
				try {
					fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
				} catch (err: any) {
					console.warn(`Warning: Failed to parse api-geno.config.json: ${err.message}`);
				}
			}

			const mergedOptions = { ...fileConfig, ...options };

			const outputDir = path.resolve(mergedOptions.output || mergedOptions.out || "./generated");
			const inputFile = path.resolve(mergedOptions.input || mergedOptions.in);

			if (!inputFile) {
				throw new Error("Missing input file; use --input <file> or specify in api-geno.config.json");
			}

			if (!fs.existsSync(inputFile)) {
				throw new Error(`Input file does not exist: ${inputFile}`);
			}

			const errorStyle = mergedOptions.emitOnlyShapes ? "shape" : mergedOptions.errorStyle || "both";
			const httpAdapter = mergedOptions.httpAdapter || "axios";
			const skipGeneratedOutputs = !!mergedOptions.skipGeneratedOutputs;
			const forceRegen = !!mergedOptions.force;

			if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

			const crypto = await import("crypto");
			const inputData = fs.readFileSync(inputFile, "utf8");
			const hash = crypto
				.createHash("sha256")
				.update(
					inputData +
					JSON.stringify({
						errorStyle,
						httpAdapter,
						emitOnlyShapes: !!mergedOptions.emitOnlyShapes,
						skipGeneratedOutputs,
					}),
				)
				.digest("hex");

			const hashPath = path.join(outputDir, ".api-geno.hash");
			let previousHash: string | null = null;
			if (fs.existsSync(hashPath)) previousHash = fs.readFileSync(hashPath, "utf8");

			if (!forceRegen && previousHash === hash) {
				if (!options.watch) {
					console.log("No changes detected in API + options — skipping generation.");
				}
				return;
			}

			console.log(`Generating API client to ${outputDir}...`);
			const files = generateFromOpenAPI(inputFile, [], {
				errorStyle,
				httpAdapter,
			});

			if (skipGeneratedOutputs) {
				for (const [name, content] of Object.entries(files)) {
					console.log(`--- ${name} ---`);
					console.log(content);
				}
				fs.writeFileSync(hashPath, hash, "utf8");
				return;
			}

			for (const [name, content] of Object.entries(files)) {
				const filePath = path.join(outputDir, name);
				const dir = path.dirname(filePath);
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(filePath, content, "utf-8");
			}

			fs.writeFileSync(hashPath, hash, "utf8");
			console.log("Generation complete.");
		};

		await runGeneration().catch(err => {
			console.error(`Error: ${err.message}`);
			if (!options.watch) process.exit(1);
		});

		if (options.watch) {
			const inputFile = path.resolve(options.input || "api-geno.config.json");
			console.log(`Watching for changes...`);

			const onChange = async () => {
				console.log("Change detected, regenerating...");
				await runGeneration().catch(err => console.error(`Regeneration failed: ${err.message}`));
			};

			fs.watch(inputFile, (event) => {
				if (event === "change") onChange();
			});

			const configPath = path.resolve("api-geno.config.json");
			if (fs.existsSync(configPath)) {
				fs.watch(configPath, (event) => {
					if (event === "change") onChange();
				});
			}

			// Keep process alive
			process.stdin.resume();
		}
	});

program.parse(process.argv);
