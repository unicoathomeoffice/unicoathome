import { z } from 'zod'
import { ROLES, SHIFTS } from './constants'

/** A test / procedure picked from H360's catalog (lib/h360-items.ts): code + price as H360 bills it. */
export const TestItemInput = z.object({ code: z.string().max(40), name: z.string().min(1).max(200), price: z.coerce.number().min(0).max(10_000_000), dept: z.string().max(80).optional() })
export type TestItem = z.infer<typeof TestItemInput>
/** names for `tests` (labs, reports and messages match on names): the H360 picks plus any plain names */
export const testNames = (items: { name: string }[] = [], plain: string[] = []) => [...new Set([...items.map((i) => i.name), ...plain])]
export const testsTotal = (items: { price?: number }[] = []) => items.reduce((a, i) => a + (Number(i.price) || 0), 0)

export const PatientInput = z.object({
  name: z.string().min(2),
  phone: z.string().min(6),
  altPhone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  uhid: z.string().optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  ageYears: z.coerce.number().int().min(0).max(120).optional(),
  dob: z.string().optional(),
  bloodGroup: z.string().optional(),
  address: z.object({ area: z.string().optional(), thana: z.string().optional(), full: z.string().min(3), house: z.string().max(60).optional(), flat: z.string().max(60).optional(), landmark: z.string().optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional() }), // null clears the map pin
  guardian: z.object({ name: z.string().optional(), relation: z.string().optional(), phone: z.string().optional() }).optional(),
  category: z.string().max(60).optional(),
  company: z.string().max(120).optional(),
  religion: z.string().max(40).optional(),
  maritalStatus: z.string().max(40).optional(),
  nationality: z.string().max(60).optional(),
  nid: z.string().max(40).optional(),
  passport: z.string().max(40).optional(),
  occupation: z.string().max(80).optional(),
  permanentAddress: z.string().max(300).optional(),
  family: z.object({ father: z.string().max(80).optional(), mother: z.string().max(80).optional(), spouse: z.string().max(80).optional() }).optional(),
  allergies: z.array(z.string()).optional(),
  conditions: z.array(z.string()).optional(),
  consent: z.object({ whatsapp: z.boolean(), email: z.boolean() }).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export const UserInput = z.object({
  employeeId: z.string().min(2),
  name: z.string().min(2),
  username: z.string().optional(),
  phone: z.string().min(6),
  whatsapp: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(ROLES),
  roles: z.array(z.enum(ROLES)).max(8).default([]), // additional roles ("also acts as")
  customRoleId: z.string().optional().or(z.literal('')), // A2 custom role; '' clears it
  departmentId: z.string().optional().or(z.literal('')),
  designationId: z.string().optional().or(z.literal('')),
  skills: z.array(z.string()).default([]),
  zones: z.array(z.string()).default([]),
  platformAccess: z.array(z.enum(['web', 'app'])).optional(),
  shift: z.enum(SHIFTS).default('MORNING'),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']).default('ACTIVE'),
  availability: z.enum(['ON_DUTY', 'OFF_DUTY', 'ON_LEAVE']).optional(),
  password: z.string().min(8, 'At least 8 characters').optional(),
  vehicleId: z.string().optional().or(z.literal('')),
  supervisorId: z.string().optional().or(z.literal('')),
  licenceNo: z.string().optional(),
  licenceExpiry: z.string().optional(),
})
