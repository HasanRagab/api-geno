import { CodeBuilder } from "../codegen/builder";
import type { Schema } from "../models";
import { buildZodSchema } from "./validation";

export function generateTypes(
	schemas: Record<string, Schema>,
	options: { noZod?: boolean; flat?: boolean } = {},
): Record<string, string> {
	const files: Record<string, string> = {};
	const builder = new CodeBuilder();

	// Single consolidated types file
	if (!options.noZod) {
		builder.import(["z"], "zod");
	}
	builder.blank();

	// Generate all types in one file
	Object.entries(schemas).forEach(([name, schema]) => {
		const docLines: string[] = [];
		if (schema.description) docLines.push(...schema.description.split("\n"));
		if (schema.deprecated) {
			if (docLines.length > 0) docLines.push("");
			docLines.push("@deprecated");
		}
		if (docLines.length > 0) builder.docComment(docLines);

		if (!options.noZod) {
			builder.line(buildZodSchema(name, schema));
			builder.line(`export type ${name} = z.infer<typeof ${name}Schema>;`);
		} else {
			builder.line(
				`export type ${name} = any; // TODO: implement full type gen without zod`,
			);
		}
		builder.blank();
	});

	files["types.ts"] = builder.toString();
	return files;
}
