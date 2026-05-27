#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import { z } from "zod";
import { buildInitConfig } from "./cli-init";
import { generateFromOpenAPIContent } from "./index";
import { logger } from "./logger";
import { parseOpenAPIContent } from "./parser/openapi";
import type { GeneratorPlugin } from "./plugins/plugin";
import { ReactQueryPlugin } from "./plugins/react-query";
import type { EndpointStats } from "./reporter";
import {
	printDryRunSummary,
	printGenerationReport,
	printWatchDiff,
} from "./reporter";

// ── Plugin registry ───────────────────────────────────────────────────────────

const PLUGIN_MAP: Record<string, GeneratorPlugin> = {
	"react-query": ReactQueryPlugin,
};

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
		plugins: z.array(z.string()).optional(),
		onlyTags: z.array(z.string()).optional(),
		verbose: z.boolean().optional(),
		pollInterval: z.number().optional(),
		postGenerate: z.string().optional(),
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

interface HashMeta {
	hash: string;
	adapter: string;
	endpoints: number;
	outputDir: string;
	generatedAt: string;
}

function readHashFile(hashPath: string): string {
	const raw = fs.readFileSync(hashPath, "utf-8");
	try {
		const parsed = JSON.parse(raw) as { hash?: string };
		return parsed.hash ?? raw;
	} catch {
		return raw;
	}
}

function writeHashFile(
	hashPath: string,
	hash: string,
	meta: Omit<HashMeta, "hash" | "generatedAt">,
): void {
	const record: HashMeta = {
		hash,
		...meta,
		generatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(hashPath, JSON.stringify(record), "utf-8");
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
  api-geno generate -i api.json -o src/api --plugin react-query
  api-geno generate -i api.json -o src/api --only Users,Orders
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
		"Print a summary of generated files instead of writing them",
	)
	.option(
		"-w, --watch",
		"Re-generate on spec changes (polls every 5s for URLs)",
	)
	.option(
		"--plugin <names>",
		"Plugins to activate, comma-separated: react-query",
	)
	.option(
		"--only <tags>",
		"Only generate services for these tags, comma-separated (e.g. Users,Orders)",
	)
	.option("--verbose", "Print per-endpoint details after generation")
	.option(
		"--poll-interval <ms>",
		"URL polling interval in milliseconds (default: 5000)",
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
		const verbose = !!merged.verbose;
		const pollInterval = merged.pollInterval
			? Number(merged.pollInterval)
			: 5000;
		const postGenerate = merged.postGenerate as string | undefined;
		const inputIsUrl = isUrl(rawInput);

		const pluginNames: string[] = [
			...((merged.plugins as string[]) ?? []),
			...((merged.plugin as string | undefined)
				?.split(",")
				.map((s: string) => s.trim())
				.filter(Boolean) ?? []),
		];
		const plugins = pluginNames
			.map((name) => {
				const p = PLUGIN_MAP[name];
				if (!p) logger.warn(`Unknown plugin: "${name}" — skipping.`);
				return p;
			})
			.filter((p): p is GeneratorPlugin => p !== undefined);

		const onlyTags: string[] | undefined = merged.only
			? String(merged.only)
					.split(",")
					.map((s: string) => s.trim())
					.filter(Boolean)
			: (merged.onlyTags as string[] | undefined);

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
				readHashFile(hashPath) === hash
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
				({ files, stats } = generateFromOpenAPIContent(content, plugins, {
					errorStyle,
					httpAdapter,
					flat,
					noZod,
					splitServices,
					report: doReport,
					onlyTags,
				}));
				spinner.succeed("Generation complete.");
			} catch (err) {
				spinner.fail("Generation failed.");
				throw err;
			}

			if (verbose) {
				for (const ep of stats.endpoints) {
					const warns =
						ep.warnings.length > 0
							? `  ${ep.warnings.map((w) => pc.yellow(`⚠ ${w}`)).join("  ")}`
							: "";
					logger.dim(
						`  ${ep.method.padEnd(6)} ${ep.path.padEnd(40)} → ${ep.responseType}${warns}`,
					);
				}
			}

			if (dryRun) {
				printDryRunSummary(files);
				writeHashFile(hashPath, hash, {
					adapter: httpAdapter,
					endpoints: 0,
					outputDir,
				});
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

			writeHashFile(hashPath, hash, {
				adapter: httpAdapter,
				endpoints: stats.endpoints.length,
				outputDir,
			});

			if (doFormat) {
				const fmtSpinner = ora({ text: "Formatting…", color: "cyan" }).start();
				runFormatter(outputDir);
				fmtSpinner.succeed("Formatting complete.");
			}

			if (postGenerate) {
				logger.info(`Running post-generate hook: ${postGenerate}`);
				const result = spawnSync(postGenerate, {
					stdio: "inherit",
					shell: true,
				});
				if (result.status !== 0) {
					logger.warn(
						`Post-generate hook exited with code ${result.status ?? "unknown"}.`,
					);
				}
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
				? `Polling for changes every ${pollInterval}ms…`
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
			setInterval(poll, pollInterval);
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

// ── validate ─────────────────────────────────────────────────────────────────

program
	.command("validate")
	.description("Validate an OpenAPI spec for api-geno compatibility.")
	.requiredOption("-i, --input <source>", "OpenAPI spec — file path or URL")
	.action(async (opts: { input: string }) => {
		const rawInput = opts.input;
		const inputIsUrl = isUrl(rawInput);

		let content: string;
		if (inputIsUrl) {
			const spinner = ora({
				text: `Fetching spec from ${rawInput}…`,
				color: "cyan",
			}).start();
			try {
				content = await fetchSpec(rawInput);
				spinner.succeed("Spec fetched.");
			} catch (err) {
				spinner.fail("Fetch failed.");
				logger.error(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		} else {
			const inputFile = path.resolve(rawInput);
			if (!fs.existsSync(inputFile)) {
				logger.error(`Input file not found: ${inputFile}`);
				process.exit(1);
			}
			content = fs.readFileSync(inputFile, "utf-8");
		}

		let parsed: ReturnType<typeof parseOpenAPIContent>;
		try {
			parsed = parseOpenAPIContent(content);
		} catch (err) {
			logger.error(
				`Failed to parse spec: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}

		const errors: string[] = [];
		const warnings: string[] = [];

		// Missing operationIds — check raw JSON (parser auto-generates them)
		const rawSpec = JSON.parse(content) as {
			paths?: Record<string, Record<string, { operationId?: string }>>;
		};
		const HTTP_METHODS = new Set([
			"get",
			"post",
			"put",
			"patch",
			"delete",
			"head",
			"options",
		]);
		for (const [epPath, methods] of Object.entries(rawSpec.paths ?? {})) {
			for (const [method, op] of Object.entries(methods)) {
				if (HTTP_METHODS.has(method) && !op.operationId) {
					errors.push(
						`${method.toUpperCase()} ${epPath} — missing operationId`,
					);
				}
			}
		}

		// Duplicate operationIds
		const seen = new Map<string, string>();
		for (const ep of parsed.endpoints) {
			if (!ep.operationId) continue;
			if (seen.has(ep.operationId)) {
				errors.push(
					`Duplicate operationId "${ep.operationId}" on ${ep.method} ${ep.path} (first at ${seen.get(ep.operationId)})`,
				);
			} else {
				seen.set(ep.operationId, `${ep.method} ${ep.path}`);
			}
		}

		// Untyped responses
		for (const ep of parsed.endpoints) {
			if (!ep.responseRef) {
				warnings.push(
					`${ep.method} ${ep.path} — no typed response (responseRef missing)`,
				);
			}
		}

		// Untagged endpoints
		for (const ep of parsed.endpoints) {
			if (!ep.tags || ep.tags.length === 0) {
				warnings.push(
					`${ep.method} ${ep.path} — no tags (will land in ApiService)`,
				);
			}
		}

		const HR = pc.dim("─".repeat(68));
		console.log();
		console.log(`  ${pc.bold("api-geno validate")}  ${pc.dim(rawInput)}`);
		console.log(HR);
		console.log(
			`  Endpoints: ${pc.cyan(String(parsed.endpoints.length))}   Schemas: ${pc.cyan(String(Object.keys(parsed.schemas).length))}`,
		);
		console.log(HR);

		if (errors.length > 0) {
			console.log(`  ${pc.bold(pc.red("Errors"))} (${errors.length})`);
			for (const e of errors) console.log(`    ${pc.red("✖")} ${e}`);
			console.log();
		}
		if (warnings.length > 0) {
			console.log(`  ${pc.bold(pc.yellow("Warnings"))} (${warnings.length})`);
			for (const w of warnings) console.log(`    ${pc.yellow("⚠")} ${w}`);
			console.log();
		}
		if (errors.length === 0 && warnings.length === 0) {
			logger.success("Spec looks good — no issues found.");
		} else if (errors.length === 0) {
			logger.success(`No errors. ${warnings.length} warning(s).`);
		}
		console.log();

		if (errors.length > 0) process.exit(1);
	});

// ── status ────────────────────────────────────────────────────────────────────

program
	.command("status")
	.description("Show the last generation state for an output directory.")
	.option(
		"-o, --output <dir>",
		"Output directory to inspect (default: ./generated)",
		"./generated",
	)
	.action((opts: { output: string }) => {
		const outputDir = path.resolve(opts.output);
		const hashPath = path.join(outputDir, ".api-geno.hash");

		if (!fs.existsSync(outputDir)) {
			logger.warn(`Output directory not found: ${outputDir}`);
			process.exit(1);
		}
		if (!fs.existsSync(hashPath)) {
			logger.warn("No generation record found. Run `api-geno generate` first.");
			process.exit(1);
		}

		let record: Partial<HashMeta> = {};
		try {
			record = JSON.parse(
				fs.readFileSync(hashPath, "utf-8"),
			) as Partial<HashMeta>;
		} catch {
			logger.warn("Hash file is in old format — re-run generate to upgrade.");
			process.exit(1);
		}

		const rootFiles = fs
			.readdirSync(outputDir)
			.filter((f) => f.endsWith(".ts")).length;
		const servicesDir = path.join(outputDir, "services");
		const serviceCount = fs.existsSync(servicesDir)
			? fs.readdirSync(servicesDir).filter((f) => f.endsWith(".ts")).length
			: 0;

		const HR = pc.dim("─".repeat(68));
		console.log();
		console.log(`  ${pc.bold("api-geno status")}  ${pc.dim(outputDir)}`);
		console.log(HR);
		console.log(
			`  ${pc.bold("Generated")}  ${pc.cyan(record.generatedAt ?? "unknown")}`,
		);
		console.log(
			`  ${pc.bold("Adapter")}    ${pc.cyan(record.adapter ?? "unknown")}`,
		);
		console.log(
			`  ${pc.bold("Endpoints")}  ${pc.cyan(String(record.endpoints ?? "unknown"))}`,
		);
		console.log(`  ${pc.bold("Services")}   ${pc.cyan(String(serviceCount))}`);
		console.log(
			`  ${pc.bold("Files")}      ${pc.cyan(String(rootFiles + serviceCount))}`,
		);
		console.log(HR);
		console.log();
	});

// ── init ──────────────────────────────────────────────────────────────────────

program
	.command("init")
	.description(
		"Interactively create an api-geno.config.json in the current directory.",
	)
	.action(async () => {
		const configPath = path.resolve("api-geno.config.json");

		if (fs.existsSync(configPath)) {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			const answer = await new Promise<string>((resolve) =>
				rl.question(
					pc.yellow("⚠ api-geno.config.json already exists. Overwrite? [y/N] "),
					resolve,
				),
			);
			rl.close();
			if (answer.trim().toLowerCase() !== "y") {
				logger.info("Aborted.");
				return;
			}
		}

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		const ask = (q: string): Promise<string> =>
			new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

		console.log();
		console.log(`  ${pc.bold("api-geno init")} — create api-geno.config.json`);
		console.log(
			pc.dim("  Press Enter to accept defaults shown in [brackets].\n"),
		);

		const input =
			(await ask("  OpenAPI spec path or URL [openapi.json]: ")) ||
			"openapi.json";
		const output = (await ask("  Output directory [src/api]: ")) || "src/api";

		const adapterRaw =
			(await ask("  HTTP adapter — axios or fetch [axios]: ")) || "axios";
		const adapter: "axios" | "fetch" =
			adapterRaw === "fetch" ? "fetch" : "axios";

		const noZodRaw = (await ask("  Disable Zod validation? [n]: ")) || "n";
		const noZod = noZodRaw.toLowerCase() === "y";

		const splitRaw = (await ask("  Split services by tag? [Y]: ")) || "y";
		const splitServices = splitRaw.toLowerCase() !== "n";

		const pluginsRaw =
			(await ask("  Plugins (comma-separated, e.g. react-query) [none]: ")) ||
			"";
		const plugins = pluginsRaw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		rl.close();

		const config = buildInitConfig({
			input,
			output,
			adapter,
			noZod,
			splitServices,
			plugins,
		});
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

		console.log();
		logger.success("Created api-geno.config.json");
		logger.dim("  Run: api-geno generate");
		console.log();
	});

program.parse(process.argv);
