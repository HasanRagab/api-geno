import { CodeBuilder } from "../codegen/builder";

export type Resolver<T> = () => T | Promise<T>;

export interface Headers {
	[key: string]: string | Resolver<string>;
}

export type OpenAPIConfig = {
	BASE: string;
	VERSION: string;
	WITH_CREDENTIALS: boolean;
	CREDENTIALS: "include" | "omit" | "same-origin";
	TOKEN?: string | Resolver<string>;
	USERNAME?: string | Resolver<string>;
	PASSWORD?: string | Resolver<string>;
	HEADERS?: Headers | Resolver<Headers>;
	// Auth scheme support: 'bearer' (uses TOKEN), 'basic' (uses USERNAME/PASSWORD), 'apiKey' (uses API_KEY and API_KEY_IN/name)
	AUTH_SCHEME?: "bearer" | "basic" | "apiKey";
	API_KEY?: string | Resolver<string>;
	API_KEY_NAME?: string;
	API_KEY_IN?: "header" | "query";
	ENCODE_PATH?: (path: string) => string;
};

export function generateConfig(): string {
	const b = new CodeBuilder();
	b.line("export const OpenAPI: OpenAPIConfig = {");
	b.indent();
	b.line("BASE: 'http://localhost:4000',");
	b.line("VERSION: '1.0.0',");
	b.line("WITH_CREDENTIALS: false,");
	b.line("CREDENTIALS: 'include',");
	b.line("TOKEN: undefined,");
	b.line("USERNAME: undefined,");
	b.line("PASSWORD: undefined,");
	b.line("HEADERS: undefined,");
	b.line("AUTH_SCHEME: undefined,");
	b.line("API_KEY: undefined,");
	b.line("API_KEY_NAME: undefined,");
	b.line("API_KEY_IN: undefined,");
	b.line("ENCODE_PATH: undefined,");
	b.dedent();
	b.line("};");
	return b.toString();
}

export function generateConfigTypes(): string {
	const b = new CodeBuilder();
	b.line("export type Resolver<T> = () => T | Promise<T>;");
	b.blank();
	b.line("export interface Headers {");
	b.indent();
	b.line("[key: string]: string | Resolver<string>;");
	b.dedent();
	b.line("}");
	b.blank();
	b.line("export type OpenAPIConfig = {");
	b.indent();
	b.line("BASE: string;");
	b.line("VERSION: string;");
	b.line("WITH_CREDENTIALS: boolean;");
	b.line("CREDENTIALS: 'include' | 'omit' | 'same-origin';");
	b.line("TOKEN?: string | Resolver<string>;");
	b.line("USERNAME?: string | Resolver<string>;");
	b.line("PASSWORD?: string | Resolver<string>;");
	b.line("HEADERS?: Headers | Resolver<Headers>;");
	b.line("AUTH_SCHEME?: 'bearer' | 'basic' | 'apiKey';");
	b.line("API_KEY?: string | Resolver<string>;");
	b.line("API_KEY_NAME?: string;");
	b.line("API_KEY_IN?: 'header' | 'query';");
	b.line("ENCODE_PATH?: (path: string) => string;");
	b.dedent();
	b.line("};");
	return b.toString();
}
