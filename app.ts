import { ApiClient } from "./generated/client";

const api = new ApiClient({
	BASE: "http://localhost:3000",
	TOKEN: "my-secret-token",
	WITH_CREDENTIALS: true,
	VERSION: "1.0",
	CREDENTIALS: "include",
	HEADERS: () => ({
		"X-Custom-Header": "my-custom-header-value",
	}),
});

api.updateConfig({
	TOKEN: "my-updated-secret-token",
});

async function main() {
	const req = await api.assignmentsService.getAssignmentSubmission({
		params: {
			submissionId: "submission-id",
		},
	});
	if (req.isOk()) {
		console.log(req.value);
	} else {
		console.log(req.error.toJSON());
	}
}

void main();
