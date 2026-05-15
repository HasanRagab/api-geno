import { CodeBuilder } from "../codegen/builder";

export function generateErrors(
	style: "class" | "shape" | "both" = "both",
): string {
	const b = new CodeBuilder();
	const includeClasses = style === "class" || style === "both";
	const includeShapes = style === "shape" || style === "both";

	// b.import([{ name: "ok", as: "neverthrow_ok" }], "neverthrow");

	b.section("Error Types");
	b.line("export type ErrorType = 'http' | 'validation' | 'generic';");
	b.blank();

	if (includeShapes) {
		b.interface("AppErrorShape", {
			type: { type: "ErrorType" },
			name: { type: "string" },
			message: { type: "string" },
		})
			.interface("HttpErrorShape", {
				type: { type: "ErrorType" },
				name: { type: "string" },
				message: { type: "string" },
				status: { type: "number" },
				statusText: { type: "string", optional: true },
				body: { type: "unknown", optional: true },
			})
			.interface("ValidationErrorShape", {
				type: { type: "ErrorType" },
				name: { type: "string" },
				message: { type: "string" },
				issues: { type: "unknown" },
			});
	}

	const formatParamType = includeShapes
		? includeClasses
			? "AppError | AppErrorShape | any"
			: "AppErrorShape | any"
		: "AppError | any";

	// ─── Classes ─────────────────────────────
	if (includeClasses) {
		b.section("Error Classes")
			.classBlock(
				"AppError",
				(c) => {
					c.field("type", "ErrorType", { value: "'generic'" });
					c.constructorBlock("message?: string", (ctor) => {
						ctor
							.line("super(message);")
							.line("this.name = 'AppError';")
							.line("Object.setPrototypeOf(this, AppError.prototype);");
					});
					c.method("toJSON", { returns: "unknown" }, (m) => {
						m.return(
							"{ type: this.type, name: this.name, message: this.message }",
						);
					});
				},
				{ extends: "Error" },
			)

			.classBlock(
				"HttpError",
				(c) => {
					c.field("type", "ErrorType", { value: "'http'" });
					c.field("status", "number");
					c.field("statusText", "string", { optional: true });
					c.field("body", "unknown", { optional: true });
					c.constructorBlock(
						"status: number, statusText?: string, body?: unknown",
						(ctor) => {
							ctor
								.line('super(`HTTP ${status}: ${statusText || ""}`);')
								.line("this.name = 'HttpError';")
								.assign("this.status", "status")
								.assign("this.statusText", "statusText")
								.assign("this.body", "body")
								.line("Object.setPrototypeOf(this, HttpError.prototype);");
						},
					);
					c.method("toJSON", { returns: "unknown" }, (m) => {
						m.return(
							"{ type: this.type, name: this.name, message: this.message, status: this.status, statusText: this.statusText, body: this.body }",
						);
					});
				},
				{ extends: "Error" },
			)

			.classBlock(
				"ValidationError",
				(c) => {
					c.field("type", "ErrorType", { value: "'validation'" });
					c.field("issues", "unknown");
					c.constructorBlock("issues: unknown", (ctor) => {
						// formatIssue function
						ctor.function(
							"formatIssue",
							{ params: "i: any", returns: "string" },
							(f) => {
								f.tryCatch(
									(t) => {
										t.const(
											"path",
											'i?.path?.length ? i.path.join(".") : "<root>"',
										);
										t.let("details", 'i?.message || ""');

										t.if(
											'i?.code === "too_small" && i.minimum !== undefined',
											(b) =>
												b.assign(
													"details",
													'`expected >= ${i.minimum}${i.inclusive === false ? " (exclusive)" : ""}`',
												),
										);
										t.if(
											'i?.code === "too_big" && i.maximum !== undefined',
											(b) =>
												b.assign(
													"details",
													'`expected <= ${i.maximum}${i.inclusive === false ? " (exclusive)" : ""}`',
												),
										);
										t.if('i?.code === "invalid_type"', (b) =>
											b.assign(
												"details",
												'`expected type ${i.expected ?? "unknown"}${i.received ? `, received ${i.received}` : ""}`',
											),
										);
										t.if("!details", (b) =>
											b.assign("details", "JSON.stringify(i)"),
										);

										t.const(
											"received",
											'(i?.received !== undefined) ? ` (received: ${JSON.stringify(i.received)})` : ""',
										);
										t.return("`${path}: ${details}${received}`");
									},
									"_e",
									(c) => c.return("i?.message || String(i)"),
								);
							},
						);

						ctor.let("message", '""');
						ctor.ifChain([
							{
								condition: "!issues",
								body: (b) => b.assign("message", `'Validation error'`),
							},
							{
								condition: 'typeof issues === "string"',
								body: (b) => b.assign("message", "issues"),
							},
							{
								condition: "Array.isArray(issues)",
								body: (b) =>
									b.assign("message", 'issues.map(formatIssue).join("; ")'),
							},
							{
								condition: 'typeof issues === "object" && issues !== null',
								body: (b) => {
									b.const("obj", "issues as Record<string, unknown>");
									b.ifChain([
										{
											condition: "obj.issues && Array.isArray(obj.issues)",
											body: (b2) =>
												b2.assign(
													"message",
													'obj.issues.map(formatIssue).join("; ")',
												),
										},
										{
											condition: "obj.message",
											body: (b2) => b2.assign("message", "String(obj.message)"),
										},
										{
											condition: "obj.errors && Array.isArray(obj.errors)",
											body: (b2) =>
												b2.assign(
													"message",
													'obj.errors.map(formatIssue).join("; ")',
												),
										},
									]);
								},
							},
						]);
						ctor.tryCatch(
							(t) =>
								t.if("!message", (b) =>
									b.assign("message", "JSON.stringify(issues)"),
								),
							"_e",
							(c) => c.assign("message", "String(issues)"),
						);

						ctor.line("super(message);");
						ctor.line(`this.name = 'ValidationError';`);
						ctor.assign("this.issues", "issues");
						ctor.line(
							"Object.setPrototypeOf(this, ValidationError.prototype);",
						);
					});

					c.method("toJSON", { returns: "unknown" }, (m) => {
						m.return(
							"{ type: this.type, name: this.name, message: this.message, issues: this.issues }",
						);
					});
				},
				{ extends: "Error" },
			);
	}

	// ─── formatError function ─────────────────────────────
	b.function(
		"formatError",
		{ export: true, params: `err: ${formatParamType}`, returns: "string" },
		(f) => {
			f.tryCatch(
				(t) => {
					t.if("!err", (b) => b.return("'Unknown error'"));
					if (style !== "shape") {
						t.if("err instanceof ValidationError", (b) =>
							b.return("err.message"),
						);
						t.if("err instanceof HttpError", (b) => b.return("err.message"));
						t.if("err instanceof AppError", (b) =>
							b.return("err.message || String(err)"),
						);
					}
					t.if("err && typeof err === 'object' && 'message' in err", (b) =>
						b.return("(err as { message: string }).message"),
					);
					t.return("String(err)");
				},
				"_e",
				(c) => c.return("String(err)"),
			);
		},
	);

	return b.toString();
}
