import { route, body, clientMeta } from '@/lib/api'
import { DepartmentSetup, setDepartment } from '@/lib/services/department-heads'

/** PATCH /api/v1/hod/departments/:id { headIds?, serviceCodes? } — super admin names the heads and the services. */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => setDepartment(params.id, await body(req, DepartmentSetup), user, clientMeta(req, user)))
