import { AdminCoursesGroupsService, CoursesService } from "./generated/client";

async function main() {
    const req = await AdminCoursesGroupsService.addGroupToHierarchy({ params: { hierarchyId: '123', groupId: '456' } });
    if (req.isOk()) {
        console.log(req.value);
    } else {
        console.log(req.error.toJSON());
    }
}

void main();
