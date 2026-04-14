#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { generateFromOpenAPI } from "./index";

const ConfigSchema = z
	.object({
		input: z.string().optional(),
		in: z.string().optional(),
		output: z.string().optional(),
		out: z.string().optional(),
		errorStyle: z.enum(["class", "shape", "both"]).optional(),
		emitOnlyShapes: z.boolean().optional(),
		skipGeneratedOutputs: z.boolean().optional(),
		force: z.boolean().optional(),
		outputFormat: z.string().optional(),
		httpAdapter: z.enum(["axios", "fetch"]).optional(),
		flat: z.boolean().optional(),
		noZod: z.boolean().optional(),
		splitServices: z.boolean().optional(),
		format: z.boolean().optional(),
		report: z.boolean().optional(),
		watch: z.boolean().optional(),
	})
	.passthrough();

function runFormatter(outputDir: string): void {
	const biomeResult = spawnSync(
		"npx",
		["biome", "format", "--write", outputDir],
		{
			stdio: "inherit",
			shell: false,
		},
	);
	if (biomeResult.status === 0) return;

	const prettierResult = spawnSync(
		"npx",
		["prettier", "--write", `${outputDir}/**/*.{ts,js,json}`],
		{
			stdio: "inherit",
			shell: false,
		},
	);
	if (prettierResult.status !== 0) {
		console.warn("Warning: Formatting failed with both biome and prettier.");
	}
}

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
	.option("--flat", "Generate all files in a single flat directory", false)
	.option("--no-zod", "Do not generate zod validation schemas", false)
	.option(
		"--split-services",
		"Split endpoints into multiple service files (default)",
		true,
	)
	.option(
		"--no-split-services",
		"Generate all endpoints in a single ApiService",
	)
	.option(
		"--format",
		"Format generated code using biome or prettier if available",
		false,
	)
	.option("--report", "Generate a schema coverage report", false)
	.option("-w, --watch", "Watch input file for changes and regenerate")
	.action(async (opts: Record<string, unknown>, cmd: Command) => {
		const options = typeof cmd?.opts === "function" ? cmd.opts() : opts;

		const runGeneration = async () => {
			const configPath = path.resolve("api-geno.config.json");
			let fileConfig: Record<string, unknown> = {};
			if (fs.existsSync(configPath)) {
				try {
					const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
					const parsed = ConfigSchema.safeParse(raw);
					if (parsed.success) {
						fileConfig = parsed.data;
					} else {
						console.warn(
							`Warning: Invalid api-geno.config.json: ${parsed.error.message}`,
						);
					}
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					console.warn(
						`Warning: Failed to parse api-geno.config.json: ${message}`,
					);
				}
			}

			const mergedOptions = { ...fileConfig, ...options };

			const outputDir = path.resolve(
				(mergedOptions.output as string) ||
					(mergedOptions.out as string) ||
					"./generated",
			);
			const inputFile = path.resolve(
				(mergedOptions.input as string) || (mergedOptions.in as string) || "",
			);

			if (!inputFile) {
				throw new Error(
					"Missing input file; use --input <file> or specify in api-geno.config.json",
				);
			}

			if (!fs.existsSync(inputFile)) {
				throw new Error(`Input file does not exist: ${inputFile}`);
			}

			const errorStyle = mergedOptions.emitOnlyShapes
				? "shape"
				: (mergedOptions.errorStyle as string) || "both";
			const httpAdapter = (mergedOptions.httpAdapter as string) || "axios";
			const skipGeneratedOutputs = !!mergedOptions.skipGeneratedOutputs;
			const forceRegen = !!mergedOptions.force;
			const flat = !!mergedOptions.flat;
			const noZod = !!mergedOptions.noZod;
			const splitServices = mergedOptions.splitServices !== false;

			if (!fs.existsSync(outputDir))
				fs.mkdirSync(outputDir, { recursive: true });

			const crypto = await import("node:crypto");
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
							flat,
							noZod,
							splitServices,
							report: !!mergedOptions.report,
						}),
				)
				.digest("hex");

			const hashPath = path.join(outputDir, ".api-geno.hash");
			let previousHash: string | null = null;
			if (fs.existsSync(hashPath))
				previousHash = fs.readFileSync(hashPath, "utf8");

			if (!forceRegen && previousHash === hash) {
				if (!options.watch) {
					console.log(
						"No changes detected in API + options — skipping generation.",
					);
				}
				return;
			}

			console.log(`Generating API client to ${outputDir}...`);
			const files = generateFromOpenAPI(inputFile, [], {
				errorStyle: errorStyle as "class" | "shape" | "both",
				httpAdapter: httpAdapter as "axios" | "fetch",
				flat,
				noZod,
				splitServices,
				report: !!mergedOptions.report,
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

			if (mergedOptions.format) {
				console.log("Formatting generated code...");
				runFormatter(outputDir);
				console.log("Formatting complete.");
			}
		};

		await runGeneration().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Error: ${message}`);
			if (!options.watch) process.exit(1);
		});

		if (options.watch) {
			const inputFile = path.resolve(
				(options.input as string) || "api-geno.config.json",
			);
			console.log("Watching for changes...");

			const onChange = async () => {
				console.log("Change detected, regenerating...");
				await runGeneration().catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`Regeneration failed: ${message}`);
				});
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

			process.stdin.resume();
		}
	});

program.parse(process.argv);
