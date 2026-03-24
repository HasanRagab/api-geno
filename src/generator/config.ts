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

export function generateConfig(): string {
  return `export const OpenAPI: OpenAPIConfig = {
  BASE: 'http://localhost:4000',
  VERSION: '1.0.0',
  WITH_CREDENTIALS: false,
  CREDENTIALS: 'include',
  TOKEN: undefined,
  USERNAME: undefined,
  PASSWORD: undefined,
  HEADERS: undefined,
  AUTH_SCHEME: undefined,
  API_KEY: undefined,
  API_KEY_NAME: undefined,
  API_KEY_IN: undefined,
  ENCODE_PATH: undefined,
};
`;
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
