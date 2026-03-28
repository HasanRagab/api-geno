import { describe, expect, test } from "bun:test";
import { generateFromOpenAPI } from "../src/index";
import fs from "fs";
import path from "path";

describe("Phase 6 Enhancements: Content-Type Support", () => {
    test("Service methods pass correct contentType and helper handles FormData", () => {
        const spec = {
            openapi: "3.0.0",
            info: { title: "Test", version: "1.0.0" },
            paths: {
                "/upload": {
                    post: {
                        operationId: "uploadFile",
                        requestBody: {
                            content: {
                                "multipart/form-data": {
                                    schema: { type: "object", properties: { file: { type: "string", format: "binary" } } }
                                }
                            }
                        },
                        responses: { "200": { description: "OK" } }
                    }
                }
            }
        };

        const tempPath = path.join(process.cwd(), "test", "phase6_multipart.json");
        fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

        const files = generateFromOpenAPI(tempPath, []);
        fs.unlinkSync(tempPath);

        expect(files["services/ApiService.ts"]).toContain("contentType: 'multipart/form-data'");
        expect(files["request-helper.ts"]).toContain("multipart/form-data");
        expect(files["request-helper.ts"]).toContain("new FormData()");
        expect(files["request-helper.ts"]).toContain("lowerContentType.includes('application/x-www-form-urlencoded')");
    });
});
