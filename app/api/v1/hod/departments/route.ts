import { route } from '@/lib/api'
import { listDepartments } from '@/lib/services/department-heads'

/** GET /api/v1/hod/departments — departments with their heads and services. */
export const GET = route(async () => ({ items: await listDepartments() }))
