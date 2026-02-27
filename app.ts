import { CoursesService } from "./generated/client";

async function main() {
    const req = await CoursesService.findAll({ params: { limit: 10 } });
    if (req.isOk()) {
        console.log(req.value);
    } else {
        console.log(req.error.name);
    }
}

void main();