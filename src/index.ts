import { CodeBuilder } from "./codegen/builder";
import { generateClient } from "./generator/client";
import { generateCommonHelper } from "./generator/common";
import { generateConfig, generateConfigTypes } from "./generator/config";
import { generateErrors } from "./generator/errors";
import { generateHttpAdapter } from "./generator/http-adapter";
import { generateTypes } from "./generator/types";
import { generateCoverageReport } from "./generator/utils";
import type { OpenAPIModel } from "./models";
import { parseOpenAPI, parseOpenAPIContent } from "./parser/openapi";
import type { GeneratorPlugin } from "./plugins/plugin";
import type { GenerationStats } from "./reporter";

export type GenerateOptions = {
	errorStyle?: "class" | "shape" | "both";
	httpAdapter?: "axios" | "fetch";
	flat?: boolean;
	noZod?: boolean;
	splitServices?: boolean;
	report?: boolean;
	onlyTags?: string[];
	verbose?: boolean;
};

function runPipeline(
	api: OpenAPIModel,
	plugins: GeneratorPlugin[],
	options: GenerateOptions,
	startTime: number,
): { files: Record<string, string>; stats: GenerationStats } {
	for (const p of plugins) {
		p.beforeGenerate?.(api);
	}

	if (options.onlyTags && options.onlyTags.length > 0) {
		const allowed = new Set(options.onlyTags.map((t) => t.toLowerCase()));
		api.endpoints = api.endpoints.filter((ep) =>
			ep.tags?.some((t) => allowed.has(t.toLowerCase())),
		);
	}

	for (const p of plugins) {
		if (p.transformEndpoint) {
			const transform = p.transformEndpoint;
			api.endpoints = api.endpoints.map((ep) => transform(ep));
		}
		if (p.transformSchema) {
			const transform = p.transformSchema;
			api.schemas = Object.fromEntries(
				Object.entries(api.schemas).map(([name, schema]) => [
					name,
					transform(name, schema),
				]),
			);
		}
	}

	const typesFiles = generateTypes(api.schemas, {
		noZod: options.noZod,
		flat: options.flat,
	});
	const { files: clientFiles, endpointStats } = generateClient(api.endpoints, {
		errorStyle: options.errorStyle,
		splitServices: options.splitServices !== false,
		flat: options.flat,
	});
	const errorsCode = generateErrors(options.errorStyle || "both");

	const configBuilder = new CodeBuilder();
	configBuilder.raw(generateConfigTypes());
	configBuilder.blank();
	configBuilder.blank();
	configBuilder.raw(generateConfig(api.base));

	const rawFiles: Record<string, string> = {
		...typesFiles,
		...clientFiles,
		"http-adapter.ts": generateHttpAdapter(options.httpAdapter ?? "axios"),
		"errors.ts": errorsCode,
		"openapi.config.ts": configBuilder.toString(),
		"request-helper.ts": generateCommonHelper(),
	};

	if (options.report) {
		rawFiles["coverage-report.md"] = generateCoverageReport(api, rawFiles);
	}

	const files: Record<string, string> = {};
	if (options.flat) {
		for (const [name, content] of Object.entries(rawFiles)) {
			const flatName = name.split("/").pop() || name;
			files[flatName] = content
				.replace(/\.\.\/types\//g, "./")
				.replace(/\.\.\/request-helper/g, "./request-helper")
				.replace(/\.\.\/errors/g, "./errors")
				.replace(/\.\/services\//g, "./")
				.replace(/\.\/types\//g, "./");
		}
	} else {
		Object.assign(files, rawFiles);
	}

	for (const p of plugins) {
		p.afterGenerate?.(files, api);
	}

	const stats: GenerationStats = {
		endpoints: endpointStats,
		fileCount: Object.keys(files).length,
		durationMs: Date.now() - startTime,
	};

	return { files, stats };
}

export function generateFromOpenAPI(
	filePath: string,
	plugins: GeneratorPlugin[] = [],
	options: GenerateOptions = {},
): { files: Record<string, string>; stats: GenerationStats } {
	return runPipeline(parseOpenAPI(filePath), plugins, options, Date.now());
}

export function generateFromOpenAPIContent(
	content: string,
	plugins: GeneratorPlugin[] = [],
	options: GenerateOptions = {},
): { files: Record<string, string>; stats: GenerationStats } {
	return runPipeline(
		parseOpenAPIContent(content),
		plugins,
		options,
		Date.now(),
	);
}
