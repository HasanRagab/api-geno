import { describe, expect, it } from "bun:test";
import path from "node:path";
import { generateFromOpenAPI } from "../src/index";

describe("DRY, Same, and Atomic Generated Code", () => {
	const specPath = path.join(__dirname, "specs/openapi3.json");

	it("should generate atomic helper functions in request-helper.ts", () => {
		const files = generateFromOpenAPI(specPath);
		const helper = files["request-helper.ts"];

		expect(helper).toContain("function buildUrl");
		expect(helper).toContain("function validateData");
		expect(helper).toContain("function serializeBody");
		expect(helper).toContain("function getHeaders");
		expect(helper).toContain("await validateData(paramsSchema, pathParams)");
		expect(helper).toContain("await validateData(bodySchema, body)");
	});

	it("should generate DRY request calls in service files", () => {
		const files = generateFromOpenAPI(specPath);
		// Find any service file
		const serviceFile = Object.keys(files).find((k) =>
			k.startsWith("services/"),
		);
		if (!serviceFile) throw new Error("No service file found");

		const content = files[serviceFile];

		expect(content).toContain("return this.request<");

		// It should NOT contain default application/json if it's the default
		expect(content).not.toContain("contentType: 'application/json'");

		// It should NOT contain params: {} if it's empty
		expect(content).not.toContain("params: {}");
	});

	it("should use CodeBuilder import methods consistently", () => {
		const files = generateFromOpenAPI(specPath);
		const client = files["client.ts"];

		expect(client).toContain("import { BaseService } from './request-helper';");
		expect(client).toContain("import { ok, err, Result } from 'neverthrow';");
	});
});
