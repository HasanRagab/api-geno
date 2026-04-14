import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { generateCommonHelper } from "../src/generator/common";
import { getZodType } from "../src/generator/validation";
import { generateFromOpenAPI } from "../src/index";
import type { Schema } from "../src/models";
import { parseOpenAPI } from "../src/parser/openapi";

function writeTemp(name: string, spec: object): string {
	const p = path.join(process.cwd(), "test", name);
	fs.writeFileSync(p, JSON.stringify(spec), "utf8");
	return p;
}

function cleanup(p: string) {
	if (fs.existsSync(p)) fs.unlinkSync(p);
}

describe("Parser: HTTP method filtering", () => {
	test("ignores non-HTTP path-level keys like parameters/summary", () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Test", version: "1.0.0" },
			paths: {
				"/items": {
					parameters: [
						{ name: "tenantId", in: "header", schema: { type: "string" } },
					],
					summary: "Item endpoints",
					"x-custom-extension": { something: true },
					get: {
						operationId: "listItems",
						responses: { "200": { description: "OK" } },
					},
					post: {
						operationId: "createItem",
						responses: { "201": { description: "Created" } },
					},
				},
			},
			components: { schemas: {} },
		};

		const p = writeTemp("hardening_methods.json", spec);
		try {
			const model = parseOpenAPI(p);
			const methods = model.endpoints.map((e) => e.method);
			expect(methods).toEqual(["GET", "POST"]);
			expect(model.endpoints).toHaveLength(2);
		} finally {
			cleanup(p);
		}
	});

	test("handles all valid HTTP methods", () => {
		const paths: Record<string, Record<string, object>> = {};
		paths["/test"] = {};
		for (const m of [
			"get",
			"post",
			"put",
			"delete",
			"patch",
			"options",
			"head",
		]) {
			paths["/test"][m] = {
				operationId: `${m}Test`,
				responses: { "200": { description: "OK" } },
			};
		}

		const spec = {
			openapi: "3.0.0",
			info: { title: "Test", version: "1.0.0" },
			paths,
			components: { schemas: {} },
		};

		const p = writeTemp("hardening_all_methods.json", spec);
		try {
			const model = parseOpenAPI(p);
			expect(model.endpoints).toHaveLength(7);
		} finally {
			cleanup(p);
		}
	});

	test("V2 parser also filters non-method keys", () => {
		const spec = {
			swagger: "2.0",
			info: { title: "Test", version: "1.0.0" },
			host: "localhost",
			paths: {
				"/items": {
					parameters: [{ name: "tenantId", in: "header", type: "string" }],
					get: {
						operationId: "listItems",
						responses: { "200": { description: "OK" } },
					},
				},
			},
		};

		const p = writeTemp("hardening_v2_methods.json", spec);
		try {
			const model = parseOpenAPI(p);
			expect(model.endpoints).toHaveLength(1);
			expect(model.endpoints[0].method).toBe("GET");
		} finally {
			cleanup(p);
		}
	});
});

describe("Generator: falsy payload handling", () => {
	test("validateData guard uses explicit null/undefined check, not truthy", () => {
		const code = generateCommonHelper();
		expect(code).toContain("data === undefined || data === null");
		expect(code).not.toMatch(/if\s*\(\s*!data\b/);
	});

	test("serializeBody guard uses explicit null/undefined check", () => {
		const code = generateCommonHelper();
		expect(code).toContain("body === undefined || body === null");
		expect(code).not.toMatch(/if\s*\(\s*!body\b/);
	});
});

describe("Generator: regex/string escaping in zod codegen", () => {
	test("pattern with forward slashes is escaped", () => {
		const schema: Schema = {
			type: "string",
			pattern: "^https?://.*$",
		};
		const result = getZodType(schema);
		expect(result).toContain(".regex(");
		expect(result).not.toContain("//");
		expect(result).toContain("\\/");
	});

	test("pattern with backslashes is escaped", () => {
		const schema: Schema = {
			type: "string",
			pattern: "^\\d{3}-\\d{4}$",
		};
		const result = getZodType(schema);
		expect(result).toContain(".regex(");
		expect(result).toContain("\\\\d");
	});

	test("enum values with special characters are escaped", () => {
		const schema: Schema = {
			type: "string",
			enum: ['value"with"quotes', "back\\slash"],
		};
		const result = getZodType(schema);
		expect(result).toContain('\\"');
		expect(result).toContain("\\\\");
	});

	test("description with newlines and quotes is escaped", () => {
		const schema: Schema = {
			type: "string",
			description: 'A "quoted" value\nwith newlines',
		};
		const result = getZodType(schema);
		expect(result).toContain('.describe("');
		expect(result).toContain('\\"');
		expect(result).toContain("\\n");
	});

	test("default string value with quotes is escaped", () => {
		const schema: Schema = {
			type: "string",
			default: 'hello "world"',
		};
		const result = getZodType(schema);
		expect(result).toContain('.default("');
		expect(result).toContain('\\"');
	});
});

describe("CLI: config schema validation", () => {
	test("generated code from valid config works end-to-end", () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Test", version: "1.0.0" },
			paths: {},
			components: {
				schemas: {
					Dummy: { type: "object", properties: { id: { type: "string" } } },
				},
			},
		};

		const p = writeTemp("hardening_e2e.json", spec);
		try {
			const files = generateFromOpenAPI(p);
			expect(Object.keys(files).length).toBeGreaterThan(0);
			expect(files["types/Dummy.ts"]).toBeDefined();
		} finally {
			cleanup(p);
		}
	});
});
