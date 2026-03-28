/**
 * A named import/export specifier.
 *
 *   'Foo'                      → `Foo`
 *   { name: 'Foo' }            → `Foo`
 *   { name: 'Foo', as: 'Bar' } → `Foo as Bar`
 */
export type ImportName = string | { name: string; as?: string };

// export type Assignment<Name extends string, Type extends string> =
//   `${Name}: ${Type} = ${string}`;

/**
 * CodeBuilder — a fluent TypeScript code generation builder.
 *
 * Design rules:
 *  - Methods that emit lines return `this` (chainable).
 *  - Pure string helpers (ternary, join) return `string` — use them inside .line() calls.
 *  - Every structural method (block, class, method, …) accepts a callback that receives
 *    the same builder, already indented, so nesting is natural and indent/dedent are
 *    never called manually by the caller.
 */
export class CodeBuilder {
	private lines: { indent: number; text: string }[] = [];
	private currentIndent = 0;

	// ─── Core ────────────────────────────────────────────────────────────────────

	indent(n = 1) {
		this.currentIndent += n;
		return this;
	}

	dedent(n = 1) {
		this.currentIndent -= n;
		return this;
	}

	/** Emit a single line at the current indent level. */
	line(text = "") {
		this.lines.push({ indent: this.currentIndent, text });
		return this;
	}

	/** Emit a blank line. */
	blank() {
		return this.line("");
	}

	/**
	 * Emit a raw multi-line string, splitting on newlines.
	 * Useful as an escape hatch when no structured method fits.
	 */
	raw(text: string) {
		text.split("\n").forEach((l) => this.line(l));
		return this;
	}

	// ─── Structure ───────────────────────────────────────────────────────────────

	/**
	 * Generic `header {  …body…  closing` block.
	 * The body callback receives `this` already indented.
	 */
	block(header: string, body: (b: CodeBuilder) => void, closing = "}") {
		this.line(`${header} {`);
		this.indent();
		body(this);
		this.dedent();
		this.line(closing);
		return this;
	}

	/** Emit a labelled section divider — useful when reading generated output. */
	section(name: string) {
		return this.blank()
			.comment(`─── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`)
			.blank();
	}

	// ─── Composition ─────────────────────────────────────────────────────────────

	/**
	 * Create a child builder at the current indent level.
	 * Build into it independently, then `merge()` it back.
	 */
	fork(): CodeBuilder {
		const child = new CodeBuilder();
		child.currentIndent = this.currentIndent;
		return child;
	}

	/** Merge all lines from a forked child builder into this one. */
	merge(child: CodeBuilder) {
		this.lines.push(...child.lines);
		return this;
	}

	/** Conditionally execute a builder callback — avoids noisy `if` at call sites. */
	when(condition: boolean, body: (b: CodeBuilder) => void) {
		if (condition) body(this);
		return this;
	}

	// ─── Comments ────────────────────────────────────────────────────────────────

	comment(text: string) {
		return this.line(`// ${text}`);
	}

	docComment(lines: string[]) {
		this.line("/**");
		lines.forEach((l) => this.line(` * ${l}`));
		return this.line(" */");
	}

	// ─── Imports ─────────────────────────────────────────────────────────────────

	/**
	 * A named import specifier — optionally aliased.
	 *   { name: 'Foo' }              → `Foo`
	 *   { name: 'Foo', as: 'Bar' }   → `Foo as Bar`
	 */
	// (type alias used internally by all import/export methods)
	private _specifiers(names: ImportName[]): string {
		return names
			.map((n) =>
				typeof n === "string" ? n : n.as ? `${n.name} as ${n.as}` : n.name,
			)
			.join(", ");
	}

	/**
	 * Format a specifier list, breaking to multi-line when it would exceed
	 * `lineWidth` characters (default 80).
	 */
	private _specifierBlock(specifiers: string, lineWidth = 80): string {
		// rough heuristic: account for `{ … }` and surrounding syntax
		if (specifiers.length + 4 <= lineWidth) return `{ ${specifiers} }`;
		return `{\n  ${specifiers.split(", ").join(",\n  ")},\n}`;
	}

	/**
	 * `import { A, B } from 'module';`
	 *
	 * Names can be plain strings or `{ name, as }` alias objects:
	 *   b.import(['Foo', { name: 'Bar', as: 'Baz' }], './types')
	 *   → import { Foo, Bar as Baz } from './types';
	 */
	import(names: ImportName[], from: string) {
		return this.line(
			`import ${this._specifierBlock(this._specifiers(names))} from '${from}';`,
		);
	}

	/**
	 * `import type { A, B } from 'module';`
	 * Safe under `isolatedModules`. Supports aliases.
	 */
	importType(names: ImportName[], from: string) {
		return this.line(
			`import type ${this._specifierBlock(this._specifiers(names))} from '${from}';`,
		);
	}

	/**
	 * `import Default from 'module';`
	 */
	importDefault(name: string, from: string) {
		return this.line(`import ${name} from '${from}';`);
	}

	/**
	 * `import Default, { A, B } from 'module';`
	 * Mixed default + named in one statement.
	 */
	importDefaultAndNamed(
		defaultName: string,
		names: ImportName[],
		from: string,
	) {
		return this.line(
			`import ${defaultName}, ${this._specifierBlock(this._specifiers(names))} from '${from}';`,
		);
	}

	/**
	 * `import * as Alias from 'module';`
	 */
	importStar(alias: string, from: string) {
		return this.line(`import * as ${alias} from '${from}';`);
	}

	/**
	 * `import './side-effect';`
	 * Side-effect-only import — no bindings.
	 */
	importSideEffect(from: string) {
		return this.line(`import '${from}';`);
	}

	// ─── Exports ─────────────────────────────────────────────────────────────────

	/**
	 * `export { A, B };`
	 * Re-export locals without a source module. Supports aliases.
	 */
	export(names: ImportName[]) {
		return this.line(
			`export ${this._specifierBlock(this._specifiers(names))};`,
		);
	}

	/**
	 * `export type { A, B };`
	 * Type-only local export. Safe under isolatedModules.
	 */
	exportType(names: ImportName[]) {
		return this.line(
			`export type ${this._specifierBlock(this._specifiers(names))};`,
		);
	}

	/**
	 * `export default name;`
	 */
	exportDefault(name: string) {
		return this.line(`export default ${name};`);
	}

	/**
	 * `export { A, B } from 'module';`
	 * Re-export from another module. Supports aliases.
	 */
	reExport(names: ImportName[], from: string) {
		return this.line(
			`export ${this._specifierBlock(this._specifiers(names))} from '${from}';`,
		);
	}

	/**
	 * `export type { A, B } from 'module';`
	 * Type-only re-export. Safe under isolatedModules.
	 */
	reExportType(names: ImportName[], from: string) {
		return this.line(
			`export type ${this._specifierBlock(this._specifiers(names))} from '${from}';`,
		);
	}

	/**
	 * `export * from 'module';`
	 */
	reExportStar(from: string) {
		return this.line(`export * from '${from}';`);
	}

	/**
	 * `export * as Namespace from 'module';`
	 */
	reExportStarAs(alias: string, from: string) {
		return this.line(`export * as ${alias} from '${from}';`);
	}

	// ─── Variable declarations ────────────────────────────────────────────────────

	/** `const name: type = value;` */
	const(name: string, value: string, type?: string) {
		const annotation = type ? `: ${type}` : "";
		return this.line(`const ${name}${annotation} = ${value};`);
	}

	/** `let name: type = value;` */
	let(name: string, value: string, type?: string) {
		const annotation = type ? `: ${type}` : "";
		return this.line(`let ${name}${annotation} = ${value};`);
	}

	/** `target = value;` */
	assign(target: string, value: string) {
		return this.line(`${target} = ${value};`);
	}

	/**
	 * Emit an object literal, skipping `undefined` values.
	 *
	 * @example
	 *   b.object({ name: "'Hasan'", age: "30", job: undefined })
	 *   // → {
	 *   //     name: 'Hasan',
	 *   //     age: 30
	 *   //   }
	 */
	object(fields: Record<string, string | undefined>) {
		const entries = Object.entries(fields).filter(([_, v]) => v !== undefined);
		if (entries.length === 0) return this.line("{}");

		this.line("{");
		this.indent();
		entries.forEach(([k, v], i) => {
			const comma = i < entries.length - 1 ? "," : "";
			this.line(`${k}: ${v}${comma}`);
		});
		this.dedent();
		return this.line("}");
	}

	/**
	 * Emit a `const name: type = { ... }` object declaration.
	 */
	constObject(
		name: string,
		fields: Record<string, string | undefined>,
		opts: { type?: string } = {},
	) {
		const typeAnnotation = opts.type ? `: ${opts.type}` : "";
		this.line(`const ${name}${typeAnnotation} = {`);
		this.indent();
		const entries = Object.entries(fields).filter(([_, v]) => v !== undefined);
		entries.forEach(([k, v], i) => {
			const comma = i < entries.length - 1 ? "," : "";
			this.line(`${k}: ${v}${comma}`);
		});
		this.dedent();
		return this.line("};");
	}

	// ─── Statements ──────────────────────────────────────────────────────────────

	return(value: string) {
		return this.line(`return ${value};`);
	}

	throw(expression: string) {
		return this.line(`throw ${expression};`);
	}

	/** `await expression;` as a standalone statement. */
	await(expression: string) {
		return this.line(`await ${expression};`);
	}

	// ─── Type declarations ────────────────────────────────────────────────────────

	typeAlias(name: string, value: string) {
		return this.line(`export type ${name} = ${value};`);
	}

	/**
	 * Emit an `export interface` block.
	 *
	 * Fields can carry an optional flag and an optional JSDoc comment:
	 *   { type: 'string', optional: true, comment: 'The user name' }
	 */
	interface(
		name: string,
		fields: Record<
			string,
			{ type: string; optional?: boolean; comment?: string }
		>,
		opts: { extends?: string[] } = {},
	) {
		const ext = opts.extends?.length
			? ` extends ${opts.extends.join(", ")}`
			: "";
		this.line(`export interface ${name}${ext} {`);
		this.indent();
		for (const [k, v] of Object.entries(fields)) {
			if (v.comment) this.comment(v.comment);
			this.line(`${k}${v.optional ? "?" : ""}: ${v.type};`);
		}
		this.dedent();
		return this.line("}");
	}

	/**
	 * Emit an `export enum` block.
	 *
	 * Pass string values for string enums, numbers for numeric enums:
	 *   { Active: '"active"', Inactive: '"inactive"' }
	 *   { A: '0', B: '1' }
	 */
	enum(name: string, members: Record<string, string | number>) {
		this.line(`export enum ${name} {`);
		this.indent();
		const entries = Object.entries(members);
		entries.forEach(([k, v], i) => {
			const comma = i < entries.length - 1 ? "," : "";
			this.line(`${k} = ${v}${comma}`);
		});
		this.dedent();
		return this.line("}");
	}

	// ─── Namespace / module ───────────────────────────────────────────────────────

	namespace(name: string, body: (b: CodeBuilder) => void) {
		return this.block(`export namespace ${name}`, body);
	}

	// ─── Class body ──────────────────────────────────────────────────────────────

	/**
	 * Emit `export class Name extends Base implements I1, I2 { … }`.
	 */
	classBlock(
		name: string,
		body: (b: CodeBuilder) => void,
		opts: { extends?: string; implements?: string[]; export?: boolean } = {},
	) {
		const exportKw = opts.export === false ? "" : "export ";
		const ext = opts.extends ? ` extends ${opts.extends}` : "";
		const impl = opts.implements?.length
			? ` implements ${opts.implements.join(", ")}`
			: "";
		return this.block(`${exportKw}class ${name}${ext}${impl}`, body);
	}

	/**
	 * Emit a class field / property.
	 *
	 * @example
	 *   b.field('baseUrl', 'string', { visibility: 'private', readonly: true, value: "'/api'" })
	 *   // → private readonly baseUrl: string = '/api';
	 */
	field(
		name: string,
		type: string,
		opts: {
			visibility?: "public" | "protected" | "private";
			readonly?: boolean;
			static?: boolean;
			optional?: boolean;
			value?: string;
		} = {},
	) {
		const parts = [
			opts.visibility,
			opts.static && "static",
			opts.readonly && "readonly",
		]
			.filter(Boolean)
			.join(" ");
		const prefix = parts ? `${parts} ` : "";
		const optional = opts.optional ? "?" : "";
		const init = opts.value ? ` = ${opts.value}` : "";
		return this.line(`${prefix}${name}${optional}: ${type}${init};`);
	}

	/** Emit a `constructor(…) { … }` block inside a class. */
	constructorBlock(params: string, body: (b: CodeBuilder) => void) {
		return this.block(`constructor(${params})`, body);
	}

	/** Emit a `get` accessor. */
	getter(
		name: string,
		returnType: string,
		body: (b: CodeBuilder) => void,
		opts: { visibility?: "public" | "protected" | "private" } = {},
	) {
		const vis = opts.visibility ? `${opts.visibility} ` : "";
		return this.block(`${vis}get ${name}(): ${returnType}`, body);
	}

	/** Emit a `set` accessor. */
	setter(
		name: string,
		param: string,
		body: (b: CodeBuilder) => void,
		opts: { visibility?: "public" | "protected" | "private" } = {},
	) {
		const vis = opts.visibility ? `${opts.visibility} ` : "";
		return this.block(`${vis}set ${name}(${param})`, body);
	}

	/**
	 * Emit a class method.
	 *
	 * @example
	 *   b.method('fetchUser', { static: true, async: true, params: 'id: string', returns: 'Promise<User>' }, m => {
	 *     m.return('this.get(`/users/${id}`)');
	 *   });
	 */
	method(
		name: string,
		opts: {
			visibility?: "public" | "protected" | "private";
			static?: boolean;
			async?: boolean;
			abstract?: boolean;
			override?: boolean;
			params?: string;
			returns?: string;
		},
		body: (b: CodeBuilder) => void,
	) {
		const modifiers = [
			opts.visibility,
			opts.static && "static",
			opts.abstract && "abstract",
			opts.override && "override",
			opts.async && "async",
		]
			.filter(Boolean)
			.join(" ");
		const prefix = modifiers ? `${modifiers} ` : "";
		const returns = opts.returns ? `: ${opts.returns}` : "";
		return this.block(`${prefix}${name}(${opts.params ?? ""})${returns}`, body);
	}

	// ─── Functions ────────────────────────────────────────────────────────────────

	/**
	 * Emit a named function declaration.
	 *
	 * @example
	 *   b.function('add', { params: 'a: number, b: number', returns: 'number' }, f => {
	 *     f.return('a + b');
	 *   });
	 */
	function(
		name: string,
		opts: {
			async?: boolean;
			export?: boolean;
			params?: string;
			returns?: string;
		},
		body: (b: CodeBuilder) => void,
	) {
		const exportKw = opts.export ? "export " : "";
		const asyncKw = opts.async ? "async " : "";
		const returns = opts.returns ? `: ${opts.returns}` : "";
		return this.block(
			`${exportKw}${asyncKw}function ${name}(${opts.params ?? ""})${returns}`,
			body,
		);
	}

	/**
	 * Emit an arrow function — either inline (`=> expr`) or block (`=> { … }`).
	 *
	 * When `body` is a string the result is a single line; when it is a callback
	 * a full block is emitted and the closing token is `);` by default (suitable
	 * for immediately-invoked or passed-as-argument arrows).
	 */
	arrowFn(
		params: string,
		body: string | ((b: CodeBuilder) => void),
		opts: { closing?: string; async?: boolean } = {},
	) {
		const asyncKw = opts.async ? "async " : "";
		if (typeof body === "string") {
			return this.line(`${asyncKw}(${params}) => ${body}`);
		}
		return this.block(`${asyncKw}(${params}) =>`, body, opts.closing ?? ");");
	}

	// ─── Control flow ─────────────────────────────────────────────────────────────

	if(condition: string, body: (b: CodeBuilder) => void) {
		return this.block(`if (${condition})`, body);
	}

	/**
	 * Emit an if / else-if / else chain.
	 *
	 * Rules enforced at runtime:
	 *  - The first branch MUST have a condition.
	 *  - An unconditional (else) branch MUST be last.
	 *
	 * @example
	 *   b.ifChain([
	 *     { condition: "x === 1", body: b => b.return("'one'") },
	 *     { condition: "x === 2", body: b => b.return("'two'") },
	 *     {                       body: b => b.return("'other'") },
	 *   ]);
	 */
	ifChain(
		branches: Array<{ condition?: string; body: (b: CodeBuilder) => void }>,
	) {
		if (!branches[0]?.condition) {
			throw new Error("ifChain: first branch must have a condition");
		}
		const elseIndex = branches.findIndex((b) => !b.condition);
		if (elseIndex !== -1 && elseIndex !== branches.length - 1) {
			throw new Error("ifChain: unconditional else branch must be last");
		}

		branches.forEach(({ condition, body }, i) => {
			if (i === 0) {
				this.line(`if (${condition}) {`);
			} else if (condition) {
				this.line(`} else if (${condition}) {`);
			} else {
				this.line("} else {");
			}
			this.indent();
			body(this);
			this.dedent();
		});

		this.line("}");
		return this;
	}

	tryCatch(
		tryBody: (b: CodeBuilder) => void,
		catchVar: string,
		catchBody: (b: CodeBuilder) => void,
		finallyBody?: (b: CodeBuilder) => void,
	) {
		this.line("try {");
		this.indent();
		tryBody(this);
		this.dedent();
		this.line(`} catch (${catchVar}) {`);
		this.indent();
		catchBody(this);
		this.dedent();
		if (finallyBody) {
			this.line("} finally {");
			this.indent();
			finallyBody(this);
			this.dedent();
		}
		this.line("}");
		return this;
	}

	while(condition: string, body: (b: CodeBuilder) => void) {
		return this.block(`while (${condition})`, body);
	}

	forOf(
		item: string,
		iterable: string,
		body: (b: CodeBuilder) => void,
		opts: { const?: boolean } = {},
	) {
		const decl = opts.const === false ? "let" : "const";
		return this.block(`for (${decl} ${item} of ${iterable})`, body);
	}

	forIn(item: string, object: string, body: (b: CodeBuilder) => void) {
		return this.block(`for (const ${item} in ${object})`, body);
	}

	forEach(array: string, item: string, body: (b: CodeBuilder) => void) {
		return this.block(`${array}.forEach((${item}) =>`, body, "});");
	}

	// ─── Pure string helpers (do NOT emit lines) ──────────────────────────────────

	/**
	 * Build a ternary expression string.
	 * Use inside `.line()` or `.const()` etc.:
	 *   b.const('x', b.ternary('flag', '"yes"', '"no"'))
	 */
	ternary(condition: string, ifTrue: string, ifFalse: string): string {
		return `${condition} ? ${ifTrue} : ${ifFalse}`;
	}

	/**
	 * Join an array of strings with a separator.
	 * Use inside `.line()`, `.method()` params, etc.
	 */
	join(items: string[], separator = ", "): string {
		return items.join(separator);
	}

	// ─── Output ───────────────────────────────────────────────────────────────────
	/**
	 * Render all accumulated lines to a string.
	 * @param tabSize  Number of spaces per indent level (default 2).
	 */
	toString(tabSize = 2) {
		const tab = " ".repeat(tabSize);
		return this.lines
			.map(({ indent, text }) => (text ? tab.repeat(indent) + text : ""))
			.join("\n");
	}
}
