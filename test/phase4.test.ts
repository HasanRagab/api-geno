import { describe, expect, test } from "bun:test";
import { generateFromOpenAPI } from "../src/index";
import { ReactQueryPlugin } from "../src/plugins/react-query";
import fs from "fs";
import path from "path";

describe("Phase 4 Enhancements", () => {
    test("@deprecated tag is generated", () => {
        const spec = {
            openapi: "3.0.0",
            info: { title: "Test", version: "1.0.0" },
            paths: {
                "/old": {
                    get: {
                        operationId: "getOld",
                        deprecated: true,
                        responses: { "200": { description: "OK" } }
                    }
                }
            },
            components: {
                schemas: {
                    OldType: {
                        type: "object",
                        deprecated: true,
                        properties: { name: { type: "string" } }
                    }
                }
            }
        };

        const tempPath = path.join(process.cwd(), "test", "phase4_depr.json");
        fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

        const files = generateFromOpenAPI(tempPath, []);
        fs.unlinkSync(tempPath);

        expect(files["services/ApiService.ts"]).toContain("@deprecated");
        expect(files["types/OldType.ts"]).toContain("@deprecated");
    });

    test("React Query hooks have better types", () => {
        const spec = {
            openapi: "3.0.0",
            info: { title: "Test", version: "1.0.0" },
            paths: {
                "/items": {
                    get: {
                        operationId: "listItems",
                        responses: {
                            "200": {
                                content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } }
                            }
                        }
                    }
                }
            },
            components: {
                schemas: {
                    Item: { type: "object", properties: { id: { type: "string" } } }
                }
            }
        };

        const tempPath = path.join(process.cwd(), "test", "phase4_rq_types.json");
        fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

        const files = generateFromOpenAPI(tempPath, [ReactQueryPlugin]);
        fs.unlinkSync(tempPath);

        expect(files["hooks.ts"]).toContain("Result<Item, any>");
    });
});
