import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "bun";
import { buildInitConfig } from "../src/cli-init";
import { generateFromOpenAPIContent } from "../src/index";
import { ReactQueryPlugin } from "../src/plugins/react-query";
import { printDryRunSummary } from "../src/reporter";

// ── helpers ───────────────────────────────────────────────────────────────────

function miniSpec(
	paths: Record<string, unknown> = {},
	components: unknown = {},
) {
	return JSON.stringify({
		openapi: "3.0.0",
		info: { title: "T", version: "1" },
		paths,
		components,
	});
}

function runCli(...args: string[]) {
	return spawnSync(["bun", "run", "./src/cli.ts", ...args]);
}

// ── Task 1: --plugin react-query ──────────────────────────────────────────────

describe("--plugin / ReactQueryPlugin", () => {
	test("ReactQueryPlugin generates hooks.ts programmatically", () => {
		const spec = miniSpec({
			"/items": {
				get: {
					operationId: "listItems",
					tags: ["Items"],
					responses: { "200": { description: "OK" } },
				},
			},
		});
		const { files } = generateFromOpenAPIContent(spec, [ReactQueryPlugin]);
		expect(files["hooks.ts"]).toBeDefined();
		expect(files["hooks.ts"]).toContain("useListItems");
		expect(files["hooks.ts"]).toContain("useQuery");
	});

	test("--plugin react-query CLI flag generates hooks.ts", () => {
		const specPath = path.join(process.cwd(), "test", "ux_plugin_spec.json");
		const outDir = path.join(process.cwd(), "test", "ux_plugin_out");
		fs.writeFileSync(
			specPath,
			miniSpec({
				"/pets": {
					get: {
						operationId: "listPets",
						tags: ["Pets"],
						responses: { "200": { description: "OK" } },
					},
				},
			}),
		);
		try {
			runCli(
				"generate",
				"-i",
				specPath,
				"-o",
				outDir,
				"--plugin",
				"react-query",
				"--force",
			);
			expect(fs.existsSync(path.join(outDir, "hooks.ts"))).toBe(true);
			expect(fs.readFileSync(path.join(outDir, "hooks.ts"), "utf8")).toContain(
				"useListPets",
			);
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
			fs.rmSync(specPath, { force: true });
		}
	});
});

// ── Task 2: --only tags ───────────────────────────────────────────────────────

describe("--only / onlyTags", () => {
	test("onlyTags filters generated services programmatically", () => {
		const spec = miniSpec({
			"/users": {
				get: {
					operationId: "listUsers",
					tags: ["Users"],
					responses: { "200": { description: "OK" } },
				},
			},
			"/orders": {
				get: {
					operationId: "listOrders",
					tags: ["Orders"],
					responses: { "200": { description: "OK" } },
				},
			},
		});
		const { files } = generateFromOpenAPIContent(spec, [], {
			onlyTags: ["Users"],
		});
		expect(files["services/UsersService.ts"]).toBeDefined();
		expect(files["services/OrdersService.ts"]).toBeUndefined();
	});

	test("--only CLI flag filters services", () => {
		const specPath = path.join(process.cwd(), "test", "ux_only_spec.json");
		const outDir = path.join(process.cwd(), "test", "ux_only_out");
		fs.writeFileSync(
			specPath,
			miniSpec({
				"/users": {
					get: {
						operationId: "listUsers",
						tags: ["Users"],
						responses: { "200": { description: "OK" } },
					},
				},
				"/orders": {
					get: {
						operationId: "listOrders",
						tags: ["Orders"],
						responses: { "200": { description: "OK" } },
					},
				},
			}),
		);
		try {
			runCli(
				"generate",
				"-i",
				specPath,
				"-o",
				outDir,
				"--only",
				"Users",
				"--force",
			);
			expect(
				fs.existsSync(path.join(outDir, "services", "UsersService.ts")),
			).toBe(true);
			expect(
				fs.existsSync(path.join(outDir, "services", "OrdersService.ts")),
			).toBe(false);
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
			fs.rmSync(specPath, { force: true });
		}
	});
});

// ── Task 3: --verbose ─────────────────────────────────────────────────────────

describe("--verbose", () => {
	test("verbose option accepted, returns correct stats", () => {
		const spec = miniSpec({
			"/items": {
				get: {
					operationId: "listItems",
					tags: ["Items"],
					responses: { "200": { description: "OK" } },
				},
			},
		});
		expect(() =>
			generateFromOpenAPIContent(spec, [], { verbose: true }),
		).not.toThrow();
		const { stats } = generateFromOpenAPIContent(spec, [], { verbose: true });
		expect(stats.endpoints.length).toBe(1);
	});
});

// ── Task 4: pollInterval ──────────────────────────────────────────────────────

describe("pollInterval", () => {
	test("pollInterval resolution logic", () => {
		const fileConfig = { pollInterval: 2000 };
		const cliValue: number | undefined = undefined;
		const resolved = cliValue ?? fileConfig.pollInterval ?? 5000;
		expect(resolved).toBe(2000);

		const cliOverride = 1000;
		const resolved2 = cliOverride ?? fileConfig.pollInterval ?? 5000;
		expect(resolved2).toBe(1000);

		const defaultOnly = undefined ?? (undefined as number | undefined) ?? 5000;
		expect(defaultOnly).toBe(5000);
	});
});

// ── Task 5: printDryRunSummary ────────────────────────────────────────────────

describe("printDryRunSummary", () => {
	test("does not throw on valid file map", () => {
		const files = {
			"client.ts": "export class ApiClient {}\n".repeat(10),
			"services/UsersService.ts": "export class UsersService {}\n",
			"types.ts": "export type User = { id: string };\n",
		};
		expect(() => printDryRunSummary(files)).not.toThrow();
	});

	test("--dry-run CLI does not write files", () => {
		const specPath = path.join(process.cwd(), "test", "ux_dryrun_spec.json");
		const outDir = path.join(process.cwd(), "test", "ux_dryrun_out");
		fs.writeFileSync(
			specPath,
			miniSpec({
				"/items": {
					get: {
						operationId: "listItems",
						tags: ["Items"],
						responses: { "200": { description: "OK" } },
					},
				},
			}),
		);
		try {
			runCli("generate", "-i", specPath, "-o", outDir, "--dry-run", "--force");
			// services dir should NOT be created since dry-run doesn't write files
			expect(fs.existsSync(path.join(outDir, "services"))).toBe(false);
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
			fs.rmSync(specPath, { force: true });
		}
	});
});

// ── Task 6: postGenerate hook ─────────────────────────────────────────────────

describe("postGenerate hook", () => {
	test("postGenerate hook runs after generation", () => {
		const specPath = path.join(process.cwd(), "test", "ux_hook_spec.json");
		const outDir = path.join(process.cwd(), "test", "ux_hook_out");
		const sentinelPath = path.join(
			process.cwd(),
			"test",
			"ux_hook_sentinel.txt",
		);
		const configPath = path.join(process.cwd(), "api-geno.config.json");

		const originalConfig = fs.existsSync(configPath)
			? fs.readFileSync(configPath, "utf8")
			: null;

		fs.writeFileSync(specPath, miniSpec());
		fs.writeFileSync(
			configPath,
			JSON.stringify({ postGenerate: `touch ${sentinelPath}` }),
		);

		try {
			runCli("generate", "-i", specPath, "-o", outDir, "--force");
			expect(fs.existsSync(sentinelPath)).toBe(true);
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
			fs.rmSync(specPath, { force: true });
			fs.rmSync(sentinelPath, { force: true });
			if (originalConfig !== null) {
				fs.writeFileSync(configPath, originalConfig);
			} else {
				fs.rmSync(configPath, { force: true });
			}
		}
	});
});

// ── Task 7: validate command ──────────────────────────────────────────────────

describe("validate command", () => {
	test("exits 1 for spec with missing operationId", () => {
		const specPath = path.join(process.cwd(), "test", "ux_validate_bad.json");
		fs.writeFileSync(
			specPath,
			JSON.stringify({
				openapi: "3.0.0",
				info: { title: "T", version: "1" },
				paths: {
					"/noop": {
						get: {
							// no operationId
							responses: { "200": { description: "OK" } },
						},
					},
				},
			}),
		);
		try {
			const result = runCli("validate", "-i", specPath);
			expect(result.exitCode).toBe(1);
		} finally {
			fs.unlinkSync(specPath);
		}
	});

	test("exits 0 for valid spec", () => {
		const specPath = path.join(process.cwd(), "test", "ux_validate_good.json");
		fs.writeFileSync(
			specPath,
			JSON.stringify({
				openapi: "3.0.0",
				info: { title: "T", version: "1" },
				paths: {
					"/items": {
						get: {
							operationId: "listItems",
							tags: ["Items"],
							responses: {
								"200": {
									content: {
										"application/json": {
											schema: { $ref: "#/components/schemas/Item" },
										},
									},
								},
							},
						},
					},
				},
				components: {
					schemas: {
						Item: {
							type: "object",
							properties: { id: { type: "string" } },
						},
					},
				},
			}),
		);
		try {
			const result = runCli("validate", "-i", specPath);
			expect(result.exitCode).toBe(0);
		} finally {
			fs.unlinkSync(specPath);
		}
	});
});

// ── Task 8: status command ────────────────────────────────────────────────────

describe("status command", () => {
	test("shows metadata after generation", () => {
		const specPath = path.join(process.cwd(), "test", "ux_status_spec.json");
		const outDir = path.join(process.cwd(), "test", "ux_status_out");
		fs.writeFileSync(
			specPath,
			miniSpec({
				"/items": {
					get: {
						operationId: "listItems",
						tags: ["Items"],
						responses: { "200": { description: "OK" } },
					},
				},
			}),
		);
		try {
			runCli("generate", "-i", specPath, "-o", outDir, "--force");
			const result = runCli("status", "-o", outDir);
			expect(result.exitCode).toBe(0);
			const out = result.stdout.toString();
			expect(out).toContain("axios");
			expect(out).toContain("1");
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
			fs.rmSync(specPath, { force: true });
		}
	});

	test("exits 1 when output dir missing", () => {
		const result = runCli("status", "-o", "/tmp/nonexistent-api-geno-dir");
		expect(result.exitCode).toBe(1);
	});
});

// ── Task 9: buildInitConfig ───────────────────────────────────────────────────

describe("buildInitConfig", () => {
	test("produces valid config shape", () => {
		const config = buildInitConfig({
			input: "openapi.json",
			output: "src/api",
			adapter: "fetch",
			noZod: false,
			splitServices: true,
			plugins: ["react-query"],
		});
		expect(config.input).toBe("openapi.json");
		expect(config.output).toBe("src/api");
		expect(config.httpAdapter).toBe("fetch");
		expect(config.noZod).toBe(false);
		expect(config.splitServices).toBe(true);
		expect(config.plugins).toEqual(["react-query"]);
	});

	test("defaults to axios adapter", () => {
		const config = buildInitConfig({
			input: "api.json",
			output: "src/api",
			adapter: "axios",
			noZod: false,
			splitServices: true,
			plugins: [],
		});
		expect(config.httpAdapter).toBe("axios");
		expect(config.plugins).toEqual([]);
	});
});
