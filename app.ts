import { OauthService } from "./generated/client";

async function main() {
	const req = await OauthService.googleOAuth();
	if (req.isOk()) {
		console.log(req.value);
	} else {
		console.log(req.error.toJSON());
	}
}

void main();
