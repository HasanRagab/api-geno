import { expect, test } from "bun:test";
import {
	type AppErrorShape,
	formatError,
	type HttpErrorShape,
	type ValidationErrorShape,
} from "../generated/errors";

test("formatError works with AppErrorShape", () => {
	const e: AppErrorShape = { type: "app", name: "AppError", message: "oh no" };
	expect(formatError(e)).toBe("oh no");
});

test("formatError works with ValidationErrorShape", () => {
	const ve: ValidationErrorShape = {
		type: "validation",
		name: "ValidationError",
		message: "bad input",
		issues: [{ path: ["a"], message: "required" }],
	} as any;
	expect(formatError(ve)).toBe("bad input");
});

test("formatError works with HttpErrorShape", () => {
	const he: HttpErrorShape = {
		type: "http",
		name: "HttpError",
		message: "not found",
		status: 404,
	} as any;
	expect(formatError(he)).toBe("not found");
});
