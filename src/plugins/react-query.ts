import { CodeBuilder } from "../codegen/builder";
import type { Endpoint, OpenAPIModel } from "../models";
import type { GeneratorPlugin } from "./plugin";

export const ReactQueryPlugin: GeneratorPlugin = {
	name: "react-query",
	afterGenerate: (files: Record<string, string>, api: OpenAPIModel) => {
		const b = new CodeBuilder();
		b.line(
			'import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";',
		);
		b.line('import { Result } from "./errors";');
		b.line('import type { AppError } from "./errors";');

		const services: Record<string, Endpoint[]> = {};
		for (const ep of api.endpoints) {
			const tag = ep.tags?.[0] || "Default";
			if (!services[tag]) services[tag] = [];
			services[tag].push(ep);
		}

		for (const [tag, endpoints] of Object.entries(services)) {
			const serviceName = `${tag}Service`;
			b.line(`import { ${serviceName} } from "./services/${serviceName}";`);

			for (const ep of endpoints) {
				const methodName = ep.operationId;
				const hookName = `use${methodName.charAt(0).toUpperCase()}${methodName.slice(1)}`;
				const responseType = ep.responseRef || "unknown";

				if (ep.method === "GET") {
					b.line(
						`export const ${hookName} = (opts?: Record<string, unknown>, queryOpts?: UseQueryOptions<Result<${responseType}, AppError>, AppError>) => `,
					);
					b.indent();
					b.line(
						`useQuery({ queryKey: ["${tag}", "${methodName}", opts], queryFn: () => ${serviceName}.${methodName}(opts), ...queryOpts });`,
					);
					b.dedent();
				} else {
					b.line(
						`export const ${hookName} = (mutationOpts?: UseMutationOptions<Result<${responseType}, AppError>, AppError, Record<string, unknown>>) => `,
					);
					b.indent();
					b.line(
						`useMutation({ mutationFn: (opts: Record<string, unknown>) => ${serviceName}.${methodName}(opts), ...mutationOpts });`,
					);
					b.dedent();
				}
				b.blank();
			}
		}

		files["hooks.ts"] = b.toString();
	},
};
