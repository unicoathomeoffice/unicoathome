import mongoose, { Schema, Types, type Model } from 'mongoose'
import {
  AVAILABILITY,
  PAYMENT_METHODS,
  PRIORITIES,
  REQUEST_SOURCES,
  ROLES,
  SHIFTS,
  STATUSES,
  TRANSPORT_MODES,
  NOTE_TYPES,
  NOTE_VISIBILITY,
  APPROVAL_TYPES,
  VEHICLE_STATUSES,
} from './constants'

const { ObjectId, Mixed } = Schema.Types
const opts = { timestamps: true, minimize: false }

// Deliberately untyped (Model<any>): mongoose 9 generic inference over these schemas exhausts tsc memory.
function model(name: string, schema: Schema<any>, collection: string): Model<any> {
  return (mongoose.models[name] as Model<any>) || mongoose.model(name, schema, collection)
}

// ---------------------------------------------------------------- master data
const DepartmentSchema = new Schema<any>({ code: String, name: { type: String, required: true }, isActive: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 } }, opts)
export const Department = model('Department', DepartmentSchema, 'departments')

const DesignationSchema = new Schema<any>(
  { title: { type: String, required: true }, departmentId: { type: ObjectId, ref: 'Department' }, grade: String, isActive: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 } },
  opts,
)
export const Designation = model('Designation', DesignationSchema, 'designations')

const ZoneSchema = new Schema<any>(
  { name: { type: String, required: true }, travelBufferMin: { type: Number, default: 45 }, isActive: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 } },
  opts,
)
export const Zone = model('Zone', ZoneSchema, 'zones')

const ServiceTypeSchema = new Schema<any>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: String, // Doctor · Nursing · Lab · Physio · Other
    requiredSkills: [String],
    defaultDurationMin: { type: Number, default: 45 },
    fee: { type: Number, default: 0 },
    checklist: [{ _id: false, key: String, label: String, mandatory: { type: Boolean, default: true }, sortOrder: Number }],
    vitalsRequired: [String],
    staffMix: [{ _id: false, role: String, count: Number }],
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  opts,
)
export const ServiceType = model('ServiceType', ServiceTypeSchema, 'service_types')

// ---------------------------------------------------------------- users
const UserSchema = new Schema<any>(
  {
    employeeId: { type: String, required: true, unique: true },
    username: String,
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    whatsapp: String,
    email: { type: String, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, required: true },
    departmentId: { type: ObjectId, ref: 'Department' },
    designationId: { type: ObjectId, ref: 'Designation' },
    skills: [String],
    zones: [String],
    platformAccess: [{ type: String, enum: ['web', 'app'] }],
    shift: { type: String, enum: SHIFTS, default: 'MORNING' },
    availability: { type: String, enum: AVAILABILITY, default: 'ON_DUTY' },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'PENDING'], default: 'ACTIVE' },
    photoUrl: String,
    notificationPrefs: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: true },
      quietHours: { from: { type: String, default: '22:00' }, to: { type: String, default: '07:00' } },
    },
    // drivers
    vehicleId: { type: ObjectId, ref: 'Vehicle' },
    supervisorId: { type: ObjectId, ref: 'User' },
    licenceNo: String,
    licenceExpiry: Date,
    stats: { visitsMonth: { type: Number, default: 0 }, onTimePct: { type: Number, default: 0 }, avgRating: { type: Number, default: 0 } },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: Date,
    createdBy: { type: ObjectId, ref: 'User' },
    deletedAt: Date,
  },
  opts,
)
UserSchema.index({ email: 1 }, { unique: true, sparse: true })
UserSchema.index({ role: 1, availability: 1 })
export const User = model('User', UserSchema, 'users')

const SessionSchema = new Schema<any>(
  {
    userId: { type: ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    client: { type: String, enum: ['web', 'app'] },
    userAgent: String,
    ip: String,
    lastSeenAt: Date,
    expiresAt: Date,
    revokedAt: Date,
  },
  opts,
)
export const Session = model('Session', SessionSchema, 'sessions')

// ---------------------------------------------------------------- patients
const PatientSchema = new Schema<any>(
  {
    uhid: { type: String, index: { sparse: true } }, // hospital MRN / UHID
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    altPhone: String,
    gender: { type: String, enum: ['M', 'F', 'O'] },
    dob: Date,
    ageYears: Number,
    bloodGroup: String,
    address: { area: String, thana: String, district: { type: String, default: 'Dhaka' }, full: String, landmark: String, lat: Number, lng: Number },
    addressHistory: [{ _id: false, full: String, area: String, from: Date, to: Date }],
    guardian: { name: String, relation: String, phone: String },
    allergies: [String],
    conditions: [String],
    consent: { whatsapp: { type: Boolean, default: true }, email: { type: Boolean, default: true }, at: Date, by: { type: ObjectId, ref: 'User' } },
    email: String,
    tags: [String],
    notes: String,
    balance: { type: Number, default: 0 },
    source: String,
    createdBy: { type: ObjectId, ref: 'User' },
    deletedAt: Date,
  },
  opts,
)
PatientSchema.index({ name: 'text', phone: 'text', uhid: 'text' })
export const Patient = model('Patient', PatientSchema, 'patients')

// ---------------------------------------------------------------- home care requests
const stamp = { _id: false, at: Date, lat: Number, lng: Number, accuracyM: Number, deviceAt: Date, offline: Boolean }

const RequestSchema = new Schema<any>(
  {
    requestNo: { type: String, required: true, unique: true },
    patientId: { type: ObjectId, ref: 'Patient', required: true, index: true },
    patientSnapshot: { name: String, phone: String, ageYears: Number, gender: String, uhid: String, area: String, address: String },
    requester: { type: { type: String, enum: ['SELF', 'RELATIVE', 'STAFF'], default: 'SELF' }, name: String, relation: String, phone: String },
    services: [{ _id: false, serviceTypeId: { type: ObjectId, ref: 'ServiceType' }, code: String, name: String }],
    tests: [String], // Test / procedure details (Google Form)
    priority: { type: String, enum: PRIORITIES, default: 'ROUTINE' },
    status: { type: String, enum: STATUSES, default: 'NEW', index: true },
    preferred: { date: String, slot: String, time: String },
    scheduledAt: Date,
    slot: String,
    expectedDurationMin: { type: Number, default: 45 },
    clinical: { complaint: String, notes: String, referringDoctor: String, allergies: [String] },
    assignment: {
      teamSize: { type: Number, default: 1 },
      primaryStaffId: { type: ObjectId, ref: 'User' },
      secondaryStaffIds: [{ type: ObjectId, ref: 'User' }],
      assignedBy: { type: ObjectId, ref: 'User' },
      assignedAt: Date,
      acceptedAt: Date,
      respondBy: Date,
      instructions: String,
      declines: [{ _id: false, staffId: { type: ObjectId, ref: 'User' }, reason: String, note: String, at: Date }],
    },
    timeline: {
      requestedAt: Date,
      verifiedAt: Date,
      confirmedAt: Date,
      assignedAt: Date,
      acceptedAt: Date,
      enRouteAt: Date,
      checkInAt: Date,
      checkOutAt: Date,
      completedAt: Date,
      closedAt: Date,
      rescheduledAt: Date,
      cancelledAt: Date,
    },
    deviceStamps: [{ _id: false, event: String, deviceAt: Date, offline: Boolean, by: { type: ObjectId, ref: 'User' } }],
    visit: {
      checkIn: stamp,
      checkOut: stamp,
      checklist: [
        {
          _id: false,
          key: String,
          label: String,
          mandatory: Boolean,
          adHoc: Boolean,
          done: { type: Boolean, default: false },
          doneAt: Date,
          doneBy: { type: ObjectId, ref: 'User' },
          note: String,
          untickReason: String,
        },
      ],
      vitals: {
        bpSys: Number,
        bpDia: Number,
        pulse: Number,
        tempC: Number,
        spo2: Number,
        rbs: Number,
        weightKg: Number,
        painScore: Number,
        recordedAt: Date,
        recordedBy: { type: ObjectId, ref: 'User' },
        abnormal: [String],
        flagged: Boolean,
      },
      medications: [{ drug: String, dose: String, route: String, time: String, by: { type: ObjectId, ref: 'User' }, at: Date }],
      consumables: [{ _id: false, item: String, qty: Number }],
      notes: { clinical: String, nursing: String, updatedAt: Date },
      photoIds: [{ type: ObjectId, ref: 'Attachment' }],
      confirmation: { type: { type: String, enum: ['PAD', 'OTP', 'VERBAL'] }, at: Date, relation: String, name: String, attachmentId: { type: ObjectId, ref: 'Attachment' } },
      durationMin: Number,
      lateMin: Number,
      overtimeMin: Number,
      remarks: String,
      reportAt: Date,
    },
    transport: {
      needed: { type: Boolean, default: false },
      mode: { type: String, enum: TRANSPORT_MODES },
      status: { type: String, enum: ['REQUESTED', 'ASSIGNED', 'OWN', 'IN_TRIP', 'DONE'], default: undefined },
      vehicleId: { type: ObjectId, ref: 'Vehicle' },
      driverId: { type: ObjectId, ref: 'User' },
      pickupAt: Date,
      returnAt: Date,
      assignedBy: { type: ObjectId, ref: 'User' },
      assignedAt: Date,
      legs: [{ _id: false, key: String, label: String, at: Date, plannedAt: Date }],
    },
    pettyCash: [
      {
        amount: Number,
        purpose: String,
        note: String,
        requestedBy: { type: ObjectId, ref: 'User' },
        requestedAt: Date,
        status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
        decidedBy: { type: ObjectId, ref: 'User' },
        decidedAt: Date,
      },
    ],
    billing: {
      estimatedFee: Number,
      billAmount: Number, // Total amount of the patient's bill (staff at check-out)
      status: { type: String, enum: ['PAID', 'DUE', 'WAIVED'] },
      method: { type: String, enum: PAYMENT_METHODS },
      collectedBy: { type: ObjectId, ref: 'User' },
      collectedAt: Date,
      invoiceNo: String,
      invoiceAmount: Number,
      invoicePrinted: Boolean,
      reconciledBy: { type: ObjectId, ref: 'User' },
      reconciledAt: Date,
    },
    cancellation: { reason: String, by: { type: ObjectId, ref: 'User' }, at: Date },
    reschedules: [{ _id: false, from: Date, to: Date, slot: String, reason: String, by: { type: ObjectId, ref: 'User' }, at: Date }],
    feedback: { rating: Number, comment: String, at: Date },
    carePlanId: { type: ObjectId, ref: 'CarePlan' },
    source: { type: String, enum: REQUEST_SOURCES, default: 'PHONE' },
    remarks: String,
    createdBy: { type: ObjectId, ref: 'User' },
    version: { type: Number, default: 0 },
    deletedAt: Date,
  },
  opts,
)
RequestSchema.index({ status: 1, scheduledAt: 1 })
RequestSchema.index({ 'assignment.primaryStaffId': 1, status: 1, scheduledAt: 1 })
RequestSchema.index({ 'assignment.secondaryStaffIds': 1, scheduledAt: 1 })
RequestSchema.index({ patientId: 1, createdAt: -1 })
RequestSchema.index({ priority: 1, status: 1 })
RequestSchema.index({ 'transport.driverId': 1, scheduledAt: 1 })
export const HomecareRequest = model('HomecareRequest', RequestSchema, 'homecare_requests')

const AssignmentLogSchema = new Schema<any>(
  {
    requestId: { type: ObjectId, ref: 'HomecareRequest', index: true },
    fromStaffId: { type: ObjectId, ref: 'User' },
    toStaffId: { type: ObjectId, ref: 'User' },
    action: { type: String, enum: ['ASSIGN', 'REASSIGN', 'ACCEPT', 'DECLINE', 'TIMEOUT', 'HANDOVER'] },
    reason: String,
    by: { type: ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
)
export const AssignmentLog = model('AssignmentLog', AssignmentLogSchema, 'assignment_logs')

// ---------------------------------------------------------------- files
const AttachmentSchema = new Schema<any>(
  {
    ownerType: { type: String, enum: ['REQUEST', 'PATIENT', 'USER', 'CHAT'] },
    ownerId: { type: ObjectId, index: true },
    requestId: { type: ObjectId, ref: 'HomecareRequest', index: true },
    kind: { type: String, enum: ['PRESCRIPTION', 'REPORT', 'WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'SIGNATURE', 'VISIT_REPORT', 'PHOTO', 'OTHER'] },
    filename: String,
    mime: String,
    size: Number,
    data: { type: Buffer, select: false }, // stored inline (≤ 3 MB). Swap for Vercel Blob / R2 when volume grows.
    caption: String,
    uploadedBy: { type: ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    deletedAt: Date,
  },
  { timestamps: false },
)
export const Attachment = model('Attachment', AttachmentSchema, 'attachments')

// ---------------------------------------------------------------- notifications & messages
const NotificationSchema = new Schema<any>(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    type: String, // REQUEST_CREATED · ASSIGNED · ACCEPTED · DECLINED · ESCALATION · ABNORMAL_VITALS · COMPLETED · OVERDUE · RESCHEDULED · CANCELLED · CHAT · APPROVAL · TRANSPORT · SYSTEM
    title: String,
    body: String,
    priority: { type: String, enum: ['normal', 'high'], default: 'normal' },
    data: { requestId: { type: ObjectId, ref: 'HomecareRequest' }, url: String },
    channels: [String],
    readAt: Date,
  },
  opts,
)
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 })
export const Notification = model('Notification', NotificationSchema, 'notifications')

const MessageLogSchema = new Schema<any>(
  {
    channel: { type: String, enum: ['EMAIL', 'WHATSAPP', 'PUSH', 'SMS'], required: true },
    provider: String, // gmail_smtp · wa_deeplink · wa_cloud · inapp
    to: String,
    toName: String,
    subject: String,
    templateKey: String,
        renderedText: String,
    renderedHtml: String,
    requestId: { type: ObjectId, ref: 'HomecareRequest' },
    patientId: { type: ObjectId, ref: 'Patient' },
    initiatedBy: { type: ObjectId, ref: 'User' },
    status: { type: String, enum: ['PREPARED', 'QUEUED', 'SENT', 'SENT_CONFIRMED', 'DELIVERED', 'OPENED', 'FAILED', 'SKIPPED'], default: 'QUEUED' },
    events: [{ _id: false, status: String, at: Date, note: String }],
    providerId: String,
    error: String,
    attempts: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
)
MessageLogSchema.index({ requestId: 1, at: -1 })
MessageLogSchema.index({ channel: 1, at: -1 })
MessageLogSchema.index({ status: 1, at: 1 })
export const MessageLog = model('MessageLog', MessageLogSchema, 'message_logs')

const TemplateSchema = new Schema<any>(
  {
    key: { type: String, required: true, unique: true },
    name: String,
    channel: [String],
    audience: String,
    subject: String,
    body: String,
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    history: [{ _id: false, version: Number, subject: String, body: String, by: { type: ObjectId, ref: 'User' }, at: Date }],
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  opts,
)
export const Template = model('Template', TemplateSchema, 'templates')

// ---------------------------------------------------------------- audit (append-only)
const AuditLogSchema = new Schema<any>(
  {
    actorId: { type: ObjectId, ref: 'User' },
    actorName: String,
    actorRole: String,
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    entityLabel: String,
    before: Mixed,
    after: Mixed,
    ip: String,
    userAgent: String,
    client: String,
    serverAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
)
AuditLogSchema.index({ entity: 1, entityId: 1, serverAt: -1 })
AuditLogSchema.index({ actorId: 1, serverAt: -1 })
AuditLogSchema.index({ serverAt: -1 })
export const AuditLog = model('AuditLog', AuditLogSchema, 'audit_logs')

// ---------------------------------------------------------------- settings & counters
const SettingSchema = new Schema<any>({ key: { type: String, unique: true }, value: Mixed, updatedBy: { type: ObjectId, ref: 'User' } }, opts)
export const Setting = model('Setting', SettingSchema, 'settings')

const CounterSchema = new Schema<any>({ key: { type: String, unique: true }, seq: { type: Number, default: 0 } })
export const Counter = model('Counter', CounterSchema, 'counters')

// ---------------------------------------------------------------- fleet
const VehicleSchema = new Schema<any>(
  {
    name: String, // "Car 1"
    plate: { type: String, required: true },
    model: String,
    seats: Number,
    status: { type: String, enum: VEHICLE_STATUSES, default: 'FREE' },
    statusNote: String,
    driverId: { type: ObjectId, ref: 'User' },
    supervisorId: { type: ObjectId, ref: 'User' },
    odometerKm: Number,
    fuelPct: Number,
    nextServiceKm: Number,
    serviceNote: String,
    isActive: { type: Boolean, default: true },
  },
  opts,
)
export const Vehicle = model('Vehicle', VehicleSchema, 'vehicles')

// ---------------------------------------------------------------- collaboration
const NoteSchema = new Schema<any>(
  {
    authorId: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTE_TYPES, default: 'GENERAL' },
    text: { type: String, required: true },
    patientId: { type: ObjectId, ref: 'Patient' },
    requestId: { type: ObjectId, ref: 'HomecareRequest' },
    tags: [String],
    visibility: { type: String, enum: NOTE_VISIBILITY, default: 'TEAM' },
    deletedAt: Date,
  },
  opts,
)
NoteSchema.index({ createdAt: -1 })
export const Note = model('Note', NoteSchema, 'notes')

const ChatMessageSchema = new Schema<any>(
  {
    requestId: { type: ObjectId, ref: 'HomecareRequest', required: true, index: true },
    senderId: { type: ObjectId, ref: 'User' },
    kind: { type: String, enum: ['TEXT', 'SYSTEM', 'PHOTO'], default: 'TEXT' },
    text: String,
    attachmentId: { type: ObjectId, ref: 'Attachment' },
    readBy: [{ type: ObjectId, ref: 'User' }],
  },
  opts,
)
export const ChatMessage = model('ChatMessage', ChatMessageSchema, 'chat_messages')

const CarePlanSchema = new Schema<any>(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    title: String,
    serviceTypeId: { type: ObjectId, ref: 'ServiceType' },
    daysOfWeek: [Number], // 0 = Sun
    slot: String,
    time: String, // "15:00"
    startDate: Date,
    weeks: Number,
    orderedBy: String,
    status: { type: String, enum: ['ACTIVE', 'PAUSED', 'ENDED'], default: 'ACTIVE' },
    requestIds: [{ type: ObjectId, ref: 'HomecareRequest' }],
    createdBy: { type: ObjectId, ref: 'User' },
  },
  opts,
)
export const CarePlan = model('CarePlan', CarePlanSchema, 'care_plans')

const PrescriptionSchema = new Schema<any>(
  {
    requestId: { type: ObjectId, ref: 'HomecareRequest', index: true },
    patientId: { type: ObjectId, ref: 'Patient' },
    doctorId: { type: ObjectId, ref: 'User' },
    dx: String,
    items: [{ _id: false, drug: String, dose: String, duration: String, note: String }],
    advice: String,
    status: { type: String, enum: ['DRAFT', 'SIGNED'], default: 'DRAFT' },
    signedAt: Date,
    sentAt: Date,
  },
  opts,
)
export const Prescription = model('Prescription', PrescriptionSchema, 'prescriptions')

const LabResultSchema = new Schema<any>(
  {
    requestId: { type: ObjectId, ref: 'HomecareRequest', index: true },
    patientId: { type: ObjectId, ref: 'Patient', index: true },
    test: String,
    value: String,
    unit: String,
    refRange: String,
    flag: { type: String, enum: ['NORMAL', 'HIGH', 'LOW', 'ABNORMAL'] },
    summary: String,
    status: { type: String, enum: ['PENDING', 'RESULTED'], default: 'PENDING' },
    eta: Date,
    resultedAt: Date,
    by: { type: ObjectId, ref: 'User' },
  },
  opts,
)
export const LabResult = model('LabResult', LabResultSchema, 'lab_results')

const ApprovalSchema = new Schema<any>(
  {
    type: { type: String, enum: APPROVAL_TYPES, required: true },
    requestId: { type: ObjectId, ref: 'HomecareRequest' },
    userId: { type: ObjectId, ref: 'User' },
    payload: Mixed,
    reason: String,
    note: String,
    requestedBy: { type: ObjectId, ref: 'User' },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    decidedBy: { type: ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: String,
  },
  opts,
)
export const Approval = model('Approval', ApprovalSchema, 'approvals')

/** Custom roles (A2): a copy of a fixed role with a different permission set. Users keep their base role. */
const CustomRoleSchema = new Schema<any>(
  { code: { type: String, unique: true }, name: String, baseRole: { type: String, enum: ROLES }, permissions: [String], description: String, createdBy: { type: ObjectId, ref: 'User' } },
  opts,
)
export const CustomRole = model('CustomRole', CustomRoleSchema, 'custom_roles')

export { Types }
export const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id)
export const isOid = (id: unknown): id is string => typeof id === 'string' && Types.ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id)
