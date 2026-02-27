import { parseOpenAPI } from "./parser/openapi"
import { generateTypes } from "./generator/types"
import { generateClient } from "./generator/client"
import { generateConfig, generateConfigTypes } from "./generator/config"
import { generateErrors } from "./generator/errors"
import { OpenAPIModel } from "./models"
import { GeneratorPlugin } from "./plugins/plugin"

function generateHttpAdapter(): string {
  return `import axios from "axios";
import { ok, err, Result } from "neverthrow";
import { OpenAPI, type OpenAPIConfig } from "./openapi.config"
import { HttpError, AppError } from "./errors"

export interface HttpAdapter {
  request: <T>(url: string, options: any) => Promise<Result<T, AppError>>;
}

// Helper to resolve values (handle Resolver functions)
async function resolveValue<T>(value: T | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  if (value === undefined) return undefined;
  if (typeof value === 'function') return (value as any)();
  return value;
}

// Default Axios adapter with config support and content-type handling
export const httpAdapter: HttpAdapter = {
  async request(url, options) {
    try {
      // Resolve config values
      const token = await resolveValue(OpenAPI.TOKEN);
      const username = await resolveValue(OpenAPI.USERNAME);
      const password = await resolveValue(OpenAPI.PASSWORD);
      const headers = await resolveValue(OpenAPI.HEADERS);

      // Build final URL with BASE
      const finalUrl = OpenAPI.BASE + (OpenAPI.ENCODE_PATH ? OpenAPI.ENCODE_PATH(url) : url);

      // Merge headers
      const finalHeaders: Record<string, string> = {
        ...options.headers,
      };

      // Add resolved headers from config
      if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers as any)) {
          if (typeof value === 'function') {
            finalHeaders[key] = await value();
          } else {
            finalHeaders[key] = value;
          }
        }
      }

      // Add auth headers
      if (token) {
        finalHeaders['Authorization'] = 'Bearer ' + token;
      }

      // Don't set Content-Type for FormData (browser/axios will handle it with boundary)
      const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
      if (isFormData) {
        delete finalHeaders['Content-Type'];
      }

      const response = await axios({
        url: finalUrl,
        method: options.method || "GET",
        headers: finalHeaders,
        data: options.body,
        withCredentials: OpenAPI.WITH_CREDENTIALS,
      });

      return ok(response.data as any);
    } catch (error: any) {
      const status = error.response?.status || 0;
      const statusText = error.response?.statusText || error.message;
      const body = error.response?.data;
      return err(new HttpError(status, statusText, body));
    }
  }
};
`;
}

export function generateFromOpenAPI(
  filePath: string,
  plugins: GeneratorPlugin[] = [],
  options: { errorStyle?: 'class' | 'shape' | 'both' } = {}
): Record<string, string> {
  const api: OpenAPIModel = parseOpenAPI(filePath);

  plugins.forEach(p => p.beforeGenerate?.(api));

  const typesCode = generateTypes(api.schemas);
  const clientCode = generateClient(api.endpoints, { errorStyle: options.errorStyle });
  const errorsCode = generateErrors(options.errorStyle || 'both');
  const configTypesCode = generateConfigTypes();
  const configCode = generateConfig();

  const files = {
    "types.ts": typesCode,
    "client.ts": clientCode,
    "http-adapter.ts": generateHttpAdapter(),
    "errors.ts": errorsCode,
    "openapi.config.ts": configTypesCode + "\n\n" + configCode,
  };

  plugins.forEach(p => p.afterGenerate?.(files));

  return files;
}