import { AdminCoursesGroupsService, CoursesService } from "./generated/client";

async function main() {
    const req = await CoursesService.findAll();
    if (req.isOk()) {
        console.log(req.value);
    } else {
        console.log(req.error.toJSON());
    }
}

void main();
