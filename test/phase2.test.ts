import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { generateFromOpenAPI } from "../src/index";

describe("Phase 2 Enhancements", () => {
	test("Custom Axios instance is used in http-adapter", () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Test", version: "1.0.0" },
			paths: {},
			components: {},
		};

		const tempPath = path.join(process.cwd(), "test", "phase2_axios.json");
		fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

		const files = generateFromOpenAPI(tempPath, [], { httpAdapter: "axios" });
		fs.unlinkSync(tempPath);

		expect(files["http-adapter.ts"]).toContain(
			"(config.AXIOS_INSTANCE ?? axios) as typeof axios",
		);
	});

	test("Base URL is extracted from V3 servers", () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Test", version: "1.0.0" },
			servers: [{ url: "https://api.example.com/v1" }],
			paths: {},
			components: {},
		};

		const tempPath = path.join(process.cwd(), "test", "phase2_v3_base.json");
		fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

		const files = generateFromOpenAPI(tempPath, [], { httpAdapter: "axios" });
		fs.unlinkSync(tempPath);

		expect(files["openapi.config.ts"]).toContain(
			"BASE: 'https://api.example.com/v1'",
		);
	});

	test("Base URL is extracted from V2 host/schemes/basePath", () => {
		const spec = {
			swagger: "2.0",
			info: { title: "Test", version: "1.0.0" },
			host: "api.example.org",
			basePath: "/v2",
			schemes: ["https"],
			paths: {},
			definitions: {},
		};

		const tempPath = path.join(process.cwd(), "test", "phase2_v2_base.json");
		fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

		const files = generateFromOpenAPI(tempPath, [], { httpAdapter: "axios" });
		fs.unlinkSync(tempPath);

		expect(files["openapi.config.ts"]).toContain(
			"BASE: 'https://api.example.org/v2'",
		);
	});
});
