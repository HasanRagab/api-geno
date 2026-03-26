import { describe, expect, test } from "bun:test";
import { generateFromOpenAPI } from "../src/index";
import fs from "fs";
import path from "path";

describe("Phase 1 Enhancements", () => {
    test("JSDoc and Discriminators are generated", () => {
        const spec = {
            openapi: "3.0.0",
            info: { title: "Test", version: "1.0.0" },
            paths: {
                "/pet": {
                    post: {
                        summary: "Add a pet",
                        description: "Adds a new pet to the store\nSupports multiple types",
                        operationId: "addPet",
                        tags: ["Pet"],
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/Pet" }
                                }
                            }
                        },
                        responses: {
                            "200": { description: "OK" }
                        }
                    }
                }
            },
            components: {
                schemas: {
                    Pet: {
                        type: "object",
                        description: "A pet object",
                        oneOf: [
                            { $ref: "#/components/schemas/Cat" },
                            { $ref: "#/components/schemas/Dog" }
                        ],
                        discriminator: {
                            propertyName: "petType"
                        }
                    },
                    Cat: {
                        type: "object",
                        properties: {
                            petType: { type: "string", enum: ["cat"] },
                            meow: { type: "boolean" }
                        },
                        required: ["petType"]
                    },
                    Dog: {
                        type: "object",
                        properties: {
                            petType: { type: "string", enum: ["dog"] },
                            bark: { type: "boolean" }
                        },
                        required: ["petType"]
                    }
                }
            }
        };

        const tempPath = path.join(process.cwd(), "test", "phase1.json");
        fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

        const files = generateFromOpenAPI(tempPath, [], { httpAdapter: "axios" });
        fs.unlinkSync(tempPath);

        const petService = files["services/PetService.ts"];
        const petType = files["types/Pet.ts"];

        // Check JSDoc in Service
        expect(petService).toContain("* Add a pet");
        expect(petService).toContain("* Adds a new pet to the store");

        // Check JSDoc in Types
        expect(petType).toContain("* A pet object");

        // Check Discriminator
        expect(petType).toContain('z.discriminatedUnion("petType"');
    });

    test("Number enums are handled correctly", () => {
        const spec = {
            openapi: "3.0.0",
            info: { title: "Test", version: "1.0.0" },
            paths: {},
            components: {
                schemas: {
                    Status: {
                        type: "integer",
                        enum: [1, 2, 3]
                    }
                }
            }
        };

        const tempPath = path.join(process.cwd(), "test", "enums.json");
        fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

        const files = generateFromOpenAPI(tempPath, [], { httpAdapter: "axios" });
        fs.unlinkSync(tempPath);

        const statusType = files["types/Status.ts"];
        expect(statusType).toContain("z.union([z.literal(1), z.literal(2), z.literal(3)])");
    });

    test("Special string formats are handled", () => {
        const spec = {
            openapi: "3.0.0",
            info: { title: "Test", version: "1.0.0" },
            paths: {},
            components: {
                schemas: {
                    User: {
                        type: "object",
                        properties: {
                            email: { type: "string", format: "email" },
                            id: { type: "string", format: "uuid" },
                            createdAt: { type: "string", format: "date-time" }
                        }
                    }
                }
            }
        };

        const tempPath = path.join(process.cwd(), "test", "formats.json");
        fs.writeFileSync(tempPath, JSON.stringify(spec), "utf8");

        const files = generateFromOpenAPI(tempPath, [], { httpAdapter: "axios" });
        fs.unlinkSync(tempPath);

        const userType = files["types/User.ts"];
        expect(userType).toContain(".email()");
        expect(userType).toContain(".uuid()");
        expect(userType).toContain(".datetime()");
    });
});
