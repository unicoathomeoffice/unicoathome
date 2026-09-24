import { z } from 'zod'
import { ROLES, SHIFTS } from './constants'

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
  address: z.object({ area: z.string().optional(), thana: z.string().optional(), full: z.string().min(3), landmark: z.string().optional(), lat: z.number().optional(), lng: z.number().optional() }),
  guardian: z.object({ name: z.string().optional(), relation: z.string().optional(), phone: z.string().optional() }).optional(),
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
