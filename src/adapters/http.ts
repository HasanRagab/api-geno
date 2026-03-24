import axios from "axios";

export interface HttpAdapter {
	request: <T>(url: string, options: any) => Promise<T>;
}

// Default Axios adapter
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
		} catch (error: any) {
			throw new Error(
				`HTTP ${error.response?.status}: ${error.response?.statusText || error.message}`,
			);
		}
	},
};

// Default export as httpAdapter
export const httpAdapter: HttpAdapter = axiosAdapter;
