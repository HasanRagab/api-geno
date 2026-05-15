import pc from "picocolors";

export interface EndpointStats {
	method: string;
	path: string;
	methodName: string;
	service: string;
	responseType: string;
	warnings: string[];
	deprecated?: boolean;
}

export interface WrittenFile {
	name: string;
	sizeBytes: number;
}

export interface GenerationStats {
	endpoints: EndpointStats[];
	fileCount: number;
	durationMs: number;
	writtenFiles?: WrittenFile[];
}

function colorMethod(method: string): string {
	const m = method.toUpperCase();
	const pad = m.padEnd(6);
	const map: Record<string, string> = {
		GET: pc.green(pad),
		POST: pc.blue(pad),
		PUT: pc.yellow(pad),
		PATCH: pc.cyan(pad),
		DELETE: pc.red(pad),
	};
	return map[m] ?? pc.white(pad);
}

function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} b`;
	return `${(bytes / 1024).toFixed(1)} kb`;
}

const HR = pc.dim("─".repeat(68));

export function printGenerationReport(stats: GenerationStats): void {
	const { endpoints, durationMs, writtenFiles } = stats;

	const byService = new Map<string, EndpointStats[]>();
	for (const ep of endpoints) {
		if (!byService.has(ep.service)) byService.set(ep.service, []);
		// biome-ignore lint/style/noNonNullAssertion: map just set above
		byService.get(ep.service)!.push(ep);
	}

	// ── per-service tables ───────────────────────────────────────
	for (const [service, eps] of byService) {
		const depCount = eps.filter((e) => e.deprecated).length;
		const depNote = depCount > 0 ? pc.yellow(` (${depCount} deprecated)`) : "";
		console.log();
		console.log(
			`  ${pc.bold(pc.cyan(service))}  ${pc.dim(`${eps.length} endpoint${eps.length !== 1 ? "s" : ""}`)}${depNote}`,
		);
		console.log(pc.dim(`  ${"─".repeat(66)}`));

		for (const ep of eps) {
			const method = colorMethod(ep.method);
			const rawPath = ep.path.slice(0, 36).padEnd(37);
			const path = ep.deprecated
				? pc.strikethrough(pc.yellow(rawPath))
				: rawPath;
			const resp = pc.dim(
				(ep.responseType || "unknown").slice(0, 18).padEnd(19),
			);
			const warns = ep.warnings.map((w) => pc.yellow(`⚠ ${w}`)).join("  ");
			const dep = ep.deprecated ? pc.yellow(" @deprecated") : "";
			console.log(`    ${method} ${path} ${resp}${warns}${dep}`);
		}
	}

	// ── files written ────────────────────────────────────────────
	if (writtenFiles && writtenFiles.length > 0) {
		console.log();
		console.log(`  ${pc.bold("Written")}`);
		console.log(pc.dim(`  ${"─".repeat(66)}`));
		for (const f of writtenFiles) {
			const name = f.name.padEnd(48);
			console.log(
				`    ${pc.green("✔")} ${name} ${pc.dim(fmtSize(f.sizeBytes))}`,
			);
		}
	}

	// ── summary ──────────────────────────────────────────────────
	const methodCounts = new Map<string, number>();
	for (const ep of endpoints) {
		const m = ep.method.toUpperCase();
		methodCounts.set(m, (methodCounts.get(m) ?? 0) + 1);
	}
	const totalWarnings = endpoints.reduce((n, ep) => n + ep.warnings.length, 0);
	const methodSummary = ["GET", "POST", "PUT", "PATCH", "DELETE"]
		.filter((m) => methodCounts.has(m))
		.map(
			(m) =>
				`${colorMethod(m).trimEnd()} ${pc.bold(String(methodCounts.get(m)))}`,
		)
		.join("  ");

	const totalSizeBytes =
		writtenFiles?.reduce((acc, f) => acc + f.sizeBytes, 0) ?? 0;
	const sizeFmt =
		totalSizeBytes > 0
			? `  ${pc.bold("Size")}  ${pc.cyan(fmtSize(totalSizeBytes))}`
			: "";

	console.log();
	console.log(HR);
	console.log(
		`  ${pc.bold("Services")}   ${pc.cyan(String(byService.size).padEnd(4))}` +
			`  ${pc.bold("Files")}  ${pc.cyan(String(writtenFiles?.length ?? stats.fileCount).padEnd(4))}` +
			`  ${pc.bold("Time")}  ${pc.cyan(`${durationMs}ms`)}` +
			sizeFmt,
	);
	console.log(
		`  ${pc.bold("Endpoints")}  ${pc.cyan(String(endpoints.length).padEnd(3))}  ${methodSummary}`,
	);
	if (totalWarnings > 0) {
		console.log(
			`  ${pc.bold("Warnings")}   ${pc.yellow(String(totalWarnings))}`,
		);
	}
	console.log(HR);
	console.log();
}

export function printWatchDiff(
	prev: EndpointStats[],
	curr: EndpointStats[],
): void {
	const key = (e: EndpointStats) => `${e.method.toUpperCase()} ${e.path}`;
	const prevMap = new Map(prev.map((e) => [key(e), e]));
	const currMap = new Map(curr.map((e) => [key(e), e]));

	const added = curr.filter((e) => !prevMap.has(key(e)));
	const removed = prev.filter((e) => !currMap.has(key(e)));
	const changed = curr.filter((e) => {
		const p = prevMap.get(key(e));
		return p && p.responseType !== e.responseType;
	});

	if (added.length === 0 && removed.length === 0 && changed.length === 0) {
		console.log(pc.dim("  No endpoint changes."));
		return;
	}

	console.log(`  ${pc.bold("Endpoint diff")}`);
	console.log(pc.dim(`  ${"─".repeat(66)}`));

	for (const e of added) {
		console.log(
			`    ${pc.green("+")} ${colorMethod(e.method)} ${pc.green(e.path.padEnd(36))} ${pc.dim(e.responseType)}`,
		);
	}
	for (const e of removed) {
		console.log(
			`    ${pc.red("-")} ${colorMethod(e.method)} ${pc.red(e.path.padEnd(36))} ${pc.dim(e.responseType)}`,
		);
	}
	for (const e of changed) {
		// biome-ignore lint/style/noNonNullAssertion: filtered above
		const prev = prevMap.get(key(e))!;
		console.log(
			`    ${pc.yellow("~")} ${colorMethod(e.method)} ${e.path.padEnd(36)} ${pc.red(prev.responseType)} ${pc.dim("→")} ${pc.green(e.responseType)}`,
		);
	}
	console.log();
}
