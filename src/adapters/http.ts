import axios, { type AxiosError } from "axios";

export interface HttpRequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
}

export interface HttpAdapter {
	request: <T>(url: string, options: HttpRequestOptions) => Promise<T>;
}

export const axiosAdapter: HttpAdapter = {
	async request(url, options) {
		try {
			const response = await axios({
				url,
				method: options.method || "GET",
				headers: options.headers,
				data: options.body,
			});
			return response.data;
		} catch (error: unknown) {
			const axiosErr = error as AxiosError;
			throw new Error(
				`HTTP ${axiosErr.response?.status}: ${axiosErr.response?.statusText || axiosErr.message}`,
			);
		}
	},
};

export const httpAdapter: HttpAdapter = axiosAdapter;
