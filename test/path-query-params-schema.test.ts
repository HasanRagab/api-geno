import { expect, test } from "bun:test";
import path from "node:path";
import { parseOpenAPI } from "../src/parser/openapi";

test("merged QueryParams schema includes path and query parameter shapes", () => {
	const specPath = path.join(
		process.cwd(),
		"test",
		"specs",
		"path-and-query-params.json",
	);
	const { schemas } = parseOpenAPI(specPath);
	const merged = schemas.exportCourseAnalyticsCsvQueryParams;

	expect(merged?.type).toBe("object");
	expect(merged?.properties?.courseId).toBeDefined();
	expect(merged?.properties?.courseId?.format).toBe("uuid");
	expect(merged?.properties?.format).toBeDefined();
	expect(merged?.required?.includes("courseId")).toBe(true);
});
