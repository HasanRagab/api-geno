#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import ora from "ora";
import { z } from "zod";
import { generateFromOpenAPIContent } from "./index";
import { logger } from "./logger";
import type { EndpointStats } from "./reporter";
import { printGenerationReport, printWatchDiff } from "./reporter";

// ── Config file schema ────────────────────────────────────────────────────────

const ConfigSchema = z
	.object({
		input: z.string().optional(),
		output: z.string().optional(),
		errorStyle: z.enum(["class", "shape", "both"]).optional(),
		httpAdapter: z.enum(["axios", "fetch"]).optional(),
		flat: z.boolean().optional(),
		noZod: z.boolean().optional(),
		splitServices: z.boolean().optional(),
		format: z.boolean().optional(),
		report: z.boolean().optional(),
		watch: z.boolean().optional(),
		force: z.boolean().optional(),
		dryRun: z.boolean().optional(),
		// legacy aliases kept for backward compat
		out: z.string().optional(),
		in: z.string().optional(),
		emitOnlyShapes: z.boolean().optional(),
		skipGeneratedOutputs: z.boolean().optional(),
	})
	.catchall(z.unknown());

// ── Helpers ───────────────────────────────────────────────────────────────────

function isUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

async function fetchSpec(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(
			`Failed to fetch spec from ${url}: ${res.status} ${res.statusText}`,
		);
	}
	return res.text();
}

function runFormatter(outputDir: string): void {
	const biome = spawnSync("npx", ["biome", "format", "--write", outputDir], {
		stdio: "inherit",
		shell: false,
	});
	if (biome.status === 0) return;

	const prettier = spawnSync(
		"npx",
		["prettier", "--write", `${outputDir}/**/*.{ts,js,json}`],
		{ stdio: "inherit", shell: false },
	);
	if (prettier.status !== 0) {
		logger.warn("Formatting failed with both biome and prettier.");
	}
}

function loadFileConfig(): Record<string, unknown> {
	const configPath = path.resolve("api-geno.config.json");
	if (!fs.existsSync(configPath)) return {};
	try {
		const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		const parsed = ConfigSchema.safeParse(raw);
		if (parsed.success) return parsed.data;
		logger.warn(`Invalid api-geno.config.json: ${parsed.error.message}`);
	} catch (err: unknown) {
		logger.warn(
			`Failed to parse api-geno.config.json: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return {};
}

// ── Command ───────────────────────────────────────────────────────────────────

const program = new Command();

program
	.command("generate")
	.description("Generate a TypeScript API client from an OpenAPI spec.")
	.addHelpText(
		"after",
		`
Examples:
  api-geno generate -i api.json -o src/api
  api-geno generate -i https://api.example.com/openapi.json -o src/api
  api-geno generate -i api.json -o src/api --adapter fetch --error-style shape
  api-geno generate -i api.json -o src/api --no-zod --flat --dry-run
`,
	)
	.requiredOption("-i, --input <source>", "OpenAPI spec — file path or URL")
	.requiredOption("-o, --output <dir>", "Output directory")
	.option(
		"--error-style <style>",
		"Error types to emit: class | shape | both (default: both)",
	)
	.option("--adapter <adapter>", "HTTP adapter: axios | fetch (default: axios)")
	.option("--flat", "Emit all files into a single flat directory")
	.option("--no-zod", "Skip zod validation schemas")
	.option(
		"--no-split-services",
		"Emit one ApiService instead of per-tag services",
	)
	.option("--format", "Format output with biome or prettier if available")
	.option("--report", "Write a coverage-report.md to the output directory")
	.option("-f, --force", "Regenerate even when nothing has changed")
	.option(
		"--dry-run",
		"Print generated files to stdout instead of writing them",
	)
	.option(
		"-w, --watch",
		"Re-generate on spec changes (polls every 5s for URLs)",
	)
	.action(async (opts: Record<string, unknown>, cmd: Command) => {
		const cliOpts = typeof cmd?.opts === "function" ? cmd.opts() : opts;
		const fileConfig = loadFileConfig();

		// CLI wins over config file; strip undefined CLI values so they don't mask config
		const definedCliOpts = Object.fromEntries(
			Object.entries(cliOpts).filter(([, v]) => v !== undefined),
		);
		const merged = { ...fileConfig, ...definedCliOpts };

		const rawInput = (merged.input as string) || (merged.in as string) || "";
		const outputDir = path.resolve(
			(merged.output as string) || (merged.out as string) || "./generated",
		);

		if (!rawInput) {
			logger.error(
				"Missing input; use -i <file|url> or set input in api-geno.config.json",
			);
			process.exit(1);
		}

		const errorStyle: "class" | "shape" | "both" = merged.emitOnlyShapes
			? "shape"
			: (merged.errorStyle as string as "class" | "shape" | "both") || "both";
		const httpAdapter: "axios" | "fetch" = ((merged.adapter as string) ||
			(merged.httpAdapter as string) ||
			"axios") as "axios" | "fetch";
		const flat = !!merged.flat;
		// commander's --no-X flags set opts.X = false rather than opts.noX = true
		const noZod = !!merged.noZod || merged.zod === false;
		const splitServices =
			merged.splitServices !== false && merged.splitServices !== "false";
		const dryRun = !!(merged.dryRun || merged.skipGeneratedOutputs);
		const forceRegen = !!merged.force;
		const doFormat = !!merged.format;
		const doReport = !!merged.report;
		const watchMode = !!merged.watch;
		const inputIsUrl = isUrl(rawInput);

		let prevEndpoints: EndpointStats[] = [];

		// ── Core generation run ─────────────────────────────────────
		const runGeneration = async (): Promise<void> => {
			if (!fs.existsSync(outputDir))
				fs.mkdirSync(outputDir, { recursive: true });

			// Resolve content (file or URL)
			let content: string;
			if (inputIsUrl) {
				const fetchSpinner = ora({
					text: `Fetching spec from ${rawInput}…`,
					color: "cyan",
				}).start();
				try {
					content = await fetchSpec(rawInput);
					fetchSpinner.succeed("Spec fetched.");
				} catch (err) {
					fetchSpinner.fail("Fetch failed.");
					throw err;
				}
			} else {
				const inputFile = path.resolve(rawInput);
				if (!fs.existsSync(inputFile)) {
					throw new Error(`Input file not found: ${inputFile}`);
				}
				content = fs.readFileSync(inputFile, "utf-8");
			}

			// Hash for change detection
			const crypto = await import("node:crypto");
			const hash = crypto
				.createHash("sha256")
				.update(
					content +
						JSON.stringify({
							errorStyle,
							httpAdapter,
							flat,
							noZod,
							splitServices,
							doReport,
						}),
				)
				.digest("hex");

			const hashPath = path.join(outputDir, ".api-geno.hash");
			if (
				!forceRegen &&
				fs.existsSync(hashPath) &&
				fs.readFileSync(hashPath, "utf-8") === hash
			) {
				if (!watchMode)
					logger.dim("No changes detected — skipping generation.");
				return;
			}

			// Generate
			const spinner = ora({
				text: `Generating API client to ${outputDir}…`,
				color: "cyan",
			}).start();
			let files: Record<string, string>;
			let stats: ReturnType<typeof generateFromOpenAPIContent>["stats"];
			try {
				({ files, stats } = generateFromOpenAPIContent(content, [], {
					errorStyle,
					httpAdapter,
					flat,
					noZod,
					splitServices,
					report: doReport,
				}));
				spinner.succeed("Generation complete.");
			} catch (err) {
				spinner.fail("Generation failed.");
				throw err;
			}

			if (dryRun) {
				for (const [name, fileContent] of Object.entries(files)) {
					logger.log(`--- ${name} ---`);
					logger.log(fileContent);
				}
				fs.writeFileSync(hashPath, hash, "utf-8");
				printGenerationReport(stats);
				return;
			}

			// Write files
			const writtenFiles: { name: string; sizeBytes: number }[] = [];
			for (const [name, fileContent] of Object.entries(files)) {
				const filePath = path.join(outputDir, name);
				const dir = path.dirname(filePath);
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(filePath, fileContent, "utf-8");
				writtenFiles.push({
					name,
					sizeBytes: Buffer.byteLength(fileContent, "utf-8"),
				});
			}

			fs.writeFileSync(hashPath, hash, "utf-8");

			if (doFormat) {
				const fmtSpinner = ora({ text: "Formatting…", color: "cyan" }).start();
				runFormatter(outputDir);
				fmtSpinner.succeed("Formatting complete.");
			}

			if (watchMode && prevEndpoints.length > 0) {
				printWatchDiff(prevEndpoints, stats.endpoints);
			}
			prevEndpoints = stats.endpoints;

			printGenerationReport({ ...stats, writtenFiles });
		};

		// ── Initial run ─────────────────────────────────────────────
		await runGeneration().catch((err: unknown) => {
			logger.error(err instanceof Error ? err.message : String(err));
			if (!watchMode) process.exit(1);
		});

		if (!watchMode) return;

		// ── Watch mode ──────────────────────────────────────────────
		logger.watch(
			inputIsUrl
				? "Polling for changes every 5s…"
				: "Watching for file changes…",
		);

		if (inputIsUrl) {
			// Poll the URL on an interval
			const poll = async () => {
				logger.watch("Checking for spec changes…");
				await runGeneration().catch((err: unknown) => {
					logger.error(
						`Regeneration failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
			};
			setInterval(poll, 5000);
		} else {
			const inputFile = path.resolve(rawInput);
			let debounceTimer: ReturnType<typeof setTimeout> | undefined;
			const onChange = () => {
				clearTimeout(debounceTimer);
				debounceTimer = setTimeout(async () => {
					logger.watch("Change detected, regenerating…");
					await runGeneration().catch((err: unknown) => {
						logger.error(
							`Regeneration failed: ${err instanceof Error ? err.message : String(err)}`,
						);
					});
				}, 300);
			};

			fs.watch(inputFile, (event) => {
				if (event === "change") onChange();
			});

			// Also watch the config file if present
			const configPath = path.resolve("api-geno.config.json");
			if (fs.existsSync(configPath)) {
				fs.watch(configPath, (event) => {
					if (event === "change") onChange();
				});
			}
		}

		process.stdin.resume();
	});

program.parse(process.argv);
