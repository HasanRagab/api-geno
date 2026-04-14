import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { generateFromOpenAPI } from "../src/index";
import { ReactQueryPlugin } from "../src/plugins/react-query";

describe("Phase 3 Enhancements", () => {
	test("Binary responses are handled in fetch adapter", () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Test", version: "1.0.0" },
			paths: {
				"/download": {
					get: {
						responses: {
							"200": {
								content: {
									"application/octet-stream": {
										schema: { type: "string", format: "binary" },
									},
								},
							},
						},
					},
				},
			},
		};

		const tempPath = path.join(process.cwd(), "test", "phase3_binary.json");
		fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

		const files = generateFromOpenAPI(tempPath, [], { httpAdapter: "fetch" });
		fs.unlinkSync(tempPath);

		expect(files["http-adapter.ts"]).toContain("await response.blob()");
	});

	test("React Query plugin generates hooks", () => {
		const spec = {
			openapi: "3.0.0",
			info: { title: "Test", version: "1.0.0" },
			paths: {
				"/pets": {
					get: {
						operationId: "listPets",
						tags: ["Pets"],
						responses: { "200": { description: "OK" } },
					},
					post: {
						operationId: "createPet",
						tags: ["Pets"],
						responses: { "200": { description: "OK" } },
					},
				},
			},
		};

		const tempPath = path.join(process.cwd(), "test", "phase3_rq.json");
		fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

		const files = generateFromOpenAPI(tempPath, [ReactQueryPlugin]);
		fs.unlinkSync(tempPath);

		expect(files["hooks.ts"]).toBeDefined();
		expect(files["hooks.ts"]).toContain("useListPets");
		expect(files["hooks.ts"]).toContain("useCreatePet");
		expect(files["hooks.ts"]).toContain("useQuery");
		expect(files["hooks.ts"]).toContain("useMutation");
	});
});
