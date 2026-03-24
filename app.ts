import { ApiService } from "./generated/client";

async function main() {
    const req = await ApiService.get__union();
    if (req.isOk()) {
        console.log(req.value);
    } else {
        console.log(req.error.toJSON());
    }
}

void main();
