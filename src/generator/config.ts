export type Resolver<T> = () => T | Promise<T>;

export interface Headers {
  [key: string]: string | Resolver<string>;
}

export type OpenAPIConfig = {
  BASE: string;
  VERSION: string;
  WITH_CREDENTIALS: boolean;
  CREDENTIALS: 'include' | 'omit' | 'same-origin';
  TOKEN?: string | Resolver<string>;
  USERNAME?: string | Resolver<string>;
  PASSWORD?: string | Resolver<string>;
  HEADERS?: Headers | Resolver<Headers>;
  // Auth scheme support: 'bearer' (uses TOKEN), 'basic' (uses USERNAME/PASSWORD), 'apiKey' (uses API_KEY and API_KEY_IN/name)
  AUTH_SCHEME?: 'bearer' | 'basic' | 'apiKey';
  API_KEY?: string | Resolver<string>;
  API_KEY_NAME?: string;
  API_KEY_IN?: 'header' | 'query';
  ENCODE_PATH?: (path: string) => string;
};

import { Project, QuoteKind, IndentationText } from 'ts-morph';

export function generateConfig(): string {
  const project = new Project({ manipulationSettings: { quoteKind: QuoteKind.Single, indentationText: IndentationText.TwoSpaces } });
  const file = project.createSourceFile('openapi.config.ts', '', { overwrite: true });

  file.addStatements('export const OpenAPI: OpenAPIConfig = {');
  file.addStatements("  BASE: 'http://localhost:4000',");
  file.addStatements("  VERSION: '1.0.0',");
  file.addStatements('  WITH_CREDENTIALS: false,');
  file.addStatements("  CREDENTIALS: 'include',");
  file.addStatements('  TOKEN: undefined,');
  file.addStatements('  USERNAME: undefined,');
  file.addStatements('  PASSWORD: undefined,');
  file.addStatements('  HEADERS: undefined,');
  file.addStatements("  AUTH_SCHEME: undefined,");
  file.addStatements('  API_KEY: undefined,');
  file.addStatements("  API_KEY_NAME: undefined,");
  file.addStatements("  API_KEY_IN: undefined,");
  file.addStatements('  ENCODE_PATH: undefined,');
  file.addStatements('};');

  return file.getFullText();
}

export function generateConfigTypes(): string {
  return `export type Resolver<T> = () => T | Promise<T>;

export interface Headers {
  [key: string]: string | Resolver<string>;
}

export type OpenAPIConfig = {
  BASE: string;
  VERSION: string;
  WITH_CREDENTIALS: boolean;
  CREDENTIALS: 'include' | 'omit' | 'same-origin';
  TOKEN?: string | Resolver<string>;
  USERNAME?: string | Resolver<string>;
  PASSWORD?: string | Resolver<string>;
  HEADERS?: Headers | Resolver<Headers>;
  // Auth scheme support
  AUTH_SCHEME?: 'bearer' | 'basic' | 'apiKey';
  API_KEY?: string | Resolver<string>;
  API_KEY_NAME?: string;
  API_KEY_IN?: 'header' | 'query';
  ENCODE_PATH?: (path: string) => string;
};
`;
}
