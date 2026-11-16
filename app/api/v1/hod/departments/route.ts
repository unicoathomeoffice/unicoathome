import { route, body, clientMeta } from '@/lib/api'
import { DepartmentNew, createDepartment, listDepartments } from '@/lib/services/department-heads'

/** GET /api/v1/hod/departments — departments with their heads and services. */
export const GET = route(async () => ({ items: await listDepartments() }))

/** POST /api/v1/hod/departments { name, code?, headIds?, serviceCodes? } — super admin adds a department. */
export const POST = route(async ({ req, user }) => createDepartment(await body(req, DepartmentNew), user, clientMeta(req, user)))
