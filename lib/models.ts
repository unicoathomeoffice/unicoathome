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
    requiresPrescription: { type: Boolean, default: false }, // public booking must attach a prescription (e.g. injections)
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
    roles: [{ type: String, enum: ROLES }], // extra roles the person also acts as (e.g. NURSE + HC_ADMIN); permissions are the union
    customRoleId: { type: ObjectId, ref: 'CustomRole' }, // optional A2 custom role: overrides the base role's permissions
    departmentId: { type: ObjectId, ref: 'Department' },
    designationId: { type: ObjectId, ref: 'Designation' },
    // e-signature (Account page): stamped on forms only for actions this person performs
    signatureId: { type: ObjectId, ref: 'Attachment' },
    /** this person (a dept. head) lets their signature be stamped as approver on car requisitions */
    autoSignApprover: Boolean,
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
    photoUrl: String, // profile photo (/api/v1/avatars/<id>, lib/avatars.ts)
    altPhone: String,
    gender: { type: String, enum: ['M', 'F', 'O'] },
    dob: Date,
    ageYears: Number,
    bloodGroup: String,
    address: { area: String, thana: String, district: { type: String, default: 'Dhaka' }, full: String, house: String, flat: String, landmark: String, lat: Number, lng: Number },
    addressHistory: [{ _id: false, full: String, area: String, from: Date, to: Date }],
    guardian: { name: String, relation: String, phone: String }, // emergency contact
    // profile as in H360 (lib/h360-patient.ts keeps it in step; staff can edit it here too)
    category: String, // H360 patient type: GENERAL, CORPORATE, STUDENT… (constants PATIENT_CATEGORIES)
    company: String, // corporate client
    payer: { type: { type: String }, name: String },
    religion: String,
    maritalStatus: String,
    nationality: String,
    nid: String,
    passport: String,
    occupation: String,
    permanentAddress: String,
    family: { father: String, mother: String, spouse: String, guardianName: String },
    flags: { vip: Boolean, nameMasking: Boolean, handleWithCare: Boolean, fallRisk: Boolean },
    h360: { patientNo: String, syncedAt: Date, ageText: String, remarks: String },
    allergies: [String],
    conditions: [String],
    consent: { whatsapp: { type: Boolean, default: true }, email: { type: Boolean, default: true }, at: Date, by: { type: ObjectId, ref: 'User' } },
    email: String,
    // patient portal account (/my): phone is the login id; passwordVersion invalidates old sessions
    whatsapp: String,
    passwordHash: { type: String, select: false },
    passwordVersion: Number,
    googleSub: { type: String, index: { sparse: true } }, // "Continue with Google" accounts (may have no password)
    account: { createdAt: Date, lastLoginAt: Date },
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
    patientSnapshot: { name: String, phone: String, ageYears: Number, gender: String, uhid: String, area: String, address: String, photoUrl: String },
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
      /** the acceptance window passed without an answer: the coordinator decides (keep waiting / accept for them / reassign) */
      timedOutAt: Date,
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
      updateSentAt: Date, // automatic visit update (WhatsApp) went out — sent once
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
      requestedBy: { type: ObjectId, ref: 'User' }, // who asked for the Unico car (requisition "Requester")
      requisitionSentAt: Date, // Vehicle Requisition Form sent to the on-call security supervisor
      requisitionId: { type: ObjectId, ref: 'Attachment' },
      gatePassId: { type: ObjectId, ref: 'Attachment' },
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
        // given by a coordinator when no hospital car is free (lib/services/pettycash.ts): own transport + voucher
        mode: String,
        voucherNo: String,
        voucherId: { type: ObjectId, ref: 'Attachment' },
      },
    ],
    billing: {
      estimatedFee: Number,
      billAmount: Number, // Total amount of the patient's bill (staff at check-out)
      status: { type: String, enum: ['PAID', 'PARTIAL', 'DUE', 'WAIVED'] },
      /** set when a coordinator fixes the status by hand (e.g. WAIVED) — not recalculated from the invoices */
      statusOverride: { type: String, enum: ['PAID', 'PARTIAL', 'DUE', 'WAIVED'] },
      method: { type: String, enum: PAYMENT_METHODS },
      // Invoice tab: hospital bills for this visit — uploaded in the admin panel or fetched from H360
      invoices: [
        {
          invoiceNo: String,
          date: Date,
          total: Number,
          discount: Number,
          payable: Number,
          paid: Number,
          due: Number,
          attachmentId: { type: ObjectId, ref: 'Attachment' },
          source: { type: String, enum: ['UPLOAD', 'H360'], default: 'UPLOAD' },
          note: String,
          trxId: String,
          /** bill lines read from the bill (H360 PDF text or a photo) */
          items: [{ _id: false, name: String, rate: Number, qty: Number, discount: Number, amount: Number }],
          /** the bill file was saved before its invoice no / amounts were filled in */
          needsDetails: Boolean,
          /** last time paid / due were refreshed from H360 */
          h360SyncedAt: Date,
          addedBy: { type: ObjectId, ref: 'User' },
          addedAt: Date,
          updatedAt: Date,
        },
      ],
      paidAmount: Number,
      dueAmount: Number,
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
    // public booking form: how the address/location was given (GPS, map search, hand-placed pin or typed)
    intake: { _id: false, locationSource: { type: String, enum: ['gps', 'search', 'pin', 'typed'] }, accuracyM: Number, autoFields: [String] },
    remarks: String,
    // live location while the team travels: phase OUT (start journey → check-in) and RETURN (check-out → hospital)
    tracking: {
      _id: false,
      active: Boolean,
      phase: { type: String, enum: ['OUT', 'RETURN'] },
      userId: { type: ObjectId, ref: 'User' },
      lat: Number,
      lng: Number,
      accuracyM: Number,
      heading: Number,
      speed: Number, // m/s from the device
      at: Date,
      startedAt: Date,
      shareToken: { type: String, select: false }, // public tracking link /t/:token (patient)
      lostNotifiedAt: Date,
    },
    // the way back after check-out (Settings → General → hospital location)
    returnTrip: { _id: false, startedAt: Date, reachedAt: Date, reachedBy: { type: String, enum: ['geofence', 'button', 'next_visit', 'timeout'] }, distanceKm: Number, durationMin: Number },
    // own rides (Uber / Pathao / CNG / rickshaw…) with screenshots — sent to security with the requisition form and
    // added to the payer's conveyance claim (lib/services/rides.ts); can be added any time after the visit
    rides: [
      {
        userId: { type: ObjectId, ref: 'User' }, // who paid
        leg: { type: String, enum: ['OUT', 'BACK', 'OTHER'], default: 'OUT' },
        mode: String,
        amount: Number,
        at: Date,
        attachmentIds: [{ type: ObjectId, ref: 'Attachment' }],
        note: String,
        claimId: { type: ObjectId, ref: 'ExpenseClaim' },
        claimLineId: { type: ObjectId },
        requisitionId: { type: ObjectId, ref: 'Attachment' },
        sentAt: Date,
        addedBy: { type: ObjectId, ref: 'User' },
        addedAt: Date,
      },
    ],
    createdBy: { type: ObjectId, ref: 'User' },
    version: { type: Number, default: 0 },
    deletedAt: Date,
  },
  opts,
)
RequestSchema.index({ status: 1, scheduledAt: 1 })
RequestSchema.index({ 'tracking.active': 1, 'tracking.userId': 1 }, { partialFilterExpression: { 'tracking.active': true } })
RequestSchema.index({ 'tracking.shareToken': 1 }, { sparse: true })
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
    action: { type: String, enum: ['ASSIGN', 'REASSIGN', 'ACCEPT', 'ACCEPT_BY_OVERRIDE', 'DECLINE', 'TIMEOUT', 'HANDOVER'] },
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
    kind: { type: String, enum: ['PRESCRIPTION', 'REPORT', 'WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'SIGNATURE', 'VISIT_REPORT', 'PHOTO', 'INVOICE', 'REQUISITION', 'GATE_PASS', 'CLAIM', 'RECEIPT', 'AVATAR', 'VOUCHER', 'OTHER'] },
    filename: String,
    mime: String,
    size: Number,
    storage: { type: String, enum: ['mongo', 'blob'], default: 'mongo' },
    blobUrl: { type: String, select: false }, // private Vercel Blob URL (never sent to clients)
    data: { type: Buffer, select: false }, // inline fallback when Blob is not configured
    caption: String,
    uploadedBy: { type: ObjectId, ref: 'User' },
    // public booking form: uploaded before the request exists; the token links it on submit, the sweep deletes leftovers
    pending: { _id: false, token: { type: String, select: false }, ip: String, at: Date },
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
    // WhatsApp file message: the Attachment sent as a document / image, renderedText is its caption
    attachmentId: { type: ObjectId, ref: 'Attachment' },
    // WhatsApp sending safety (lib/wa/guard.ts): higher goes first; sentAt drives the rate limits
    priority: { type: Number, default: 0 },
    sentAt: Date,
    fileName: String,
    error: String,
    attempts: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
)
MessageLogSchema.index({ requestId: 1, at: -1 })
MessageLogSchema.index({ channel: 1, at: -1 })
MessageLogSchema.index({ status: 1, at: 1 })
MessageLogSchema.index({ channel: 1, provider: 1, sentAt: -1, to: 1 }, { partialFilterExpression: { sentAt: { $exists: true } } }) // WhatsApp rate limits
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

// Separate from ordinary settings: only ciphertext is persisted here.
const IntegrationSecretSchema = new Schema<any>({
  _id: String, encrypted: { type: String, required: true, select: false }, updatedBy: { type: ObjectId, ref: 'User' },
}, opts)
export const IntegrationSecret = model('IntegrationSecret', IntegrationSecretSchema, 'integration_secrets')

// ---------------------------------------------------------------- expense claims (Bill Submission / Conveyance / Food)
// One open DRAFT per staff member collects lines any time (e.g. after getting back); Submit makes the hospital's
// Bill Submission workbook + PDF and sends them to the on-call security supervisor.
const ClaimLineSchema = new Schema<any>({
  kind: { type: String, enum: ['CONVEYANCE', 'FOOD', 'OTHER'], required: true },
  requestId: { type: ObjectId, ref: 'HomecareRequest' },
  leg: { type: String, enum: ['OUT', 'BACK'] }, // conveyance suggested from a visit
  at: Date,
  uhid: String,
  patientName: String,
  invoiceNo: String,
  from: String,
  to: String,
  mode: String, // Rickshaw · Uber · Pathao · CNG · Bus · Other (conveyance) / food type (food) / expense head (other)
  amount: { type: Number, required: true },
  receiptIds: [{ type: ObjectId, ref: 'Attachment' }],
  note: String,
})
const ExpenseClaimSchema = new Schema<any>(
  {
    claimNo: { type: String, required: true, unique: true }, // CL-11432-2611-01
    userId: { type: ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'], default: 'DRAFT' },
    lines: [ClaimLineSchema],
    total: { type: Number, default: 0 },
    submittedAt: Date,
    decidedBy: { type: ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: String,
    paidAt: Date,
    paidBy: { type: ObjectId, ref: 'User' },
    xlsxId: { type: ObjectId, ref: 'Attachment' },
    pdfId: { type: ObjectId, ref: 'Attachment' },
    sentAt: Date,
  },
  opts,
)
ExpenseClaimSchema.index({ status: 1, submittedAt: -1 })
export const ExpenseClaim = model('ExpenseClaim', ExpenseClaimSchema, 'expense_claims')

// ---------------------------------------------------------------- WhatsApp numbers seen by the sender (lib/wa/guard.ts)
// exists: the number is on WhatsApp (checked before the first message, cached 30 days); optOut: replied STOP.
const WaContactSchema = new Schema<any>({ _id: String, exists: Boolean, checkedAt: Date, optOut: Boolean, optOutAt: Date }, { versionKey: false })
export const WaContact = model('WaContact', WaContactSchema, 'wa_contacts')

// ---------------------------------------------------------------- short links (/s/<code>, lib/links.ts)
// _id is the public code; target is an app-relative path. Expired links are removed by the TTL index.
const ShortLinkSchema = new Schema<any>(
  {
    _id: String,
    target: { type: String, required: true },
    kind: { type: String, default: 'OTHER' },
    requestId: { type: ObjectId, ref: 'HomecareRequest' },
    clicks: { type: Number, default: 0 },
    lastAt: Date,
    expiresAt: Date,
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
)
ShortLinkSchema.index({ target: 1 })
ShortLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $exists: true } } })
export const ShortLink = model('ShortLink', ShortLinkSchema, 'short_links')

// ---------------------------------------------------------------- live location pings (tracking trail)
const LocationPingSchema = new Schema<any>(
  {
    requestId: { type: ObjectId, ref: 'HomecareRequest', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    phase: { type: String, enum: ['OUT', 'RETURN'] },
    lat: Number,
    lng: Number,
    accuracyM: Number,
    heading: Number,
    speed: Number,
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
)
LocationPingSchema.index({ requestId: 1, at: 1 })
LocationPingSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 86400 }) // trails are kept 30 days
export const LocationPing = model('LocationPing', LocationPingSchema, 'location_pings')

// map / geocoding provider call ledger (lib/maps-usage.ts): one row per day × provider × kind
const ApiUsageSchema = new Schema<any>({ day: { type: String, required: true }, provider: { type: String, required: true }, kind: { type: String, required: true }, n: { type: Number, default: 0 } }, opts)
ApiUsageSchema.index({ day: 1, provider: 1, kind: 1 }, { unique: true })
export const ApiUsage = model('ApiUsage', ApiUsageSchema, 'api_usage')

// WhatsApp (Baileys) session + lease + meta, see lib/wa (strict off: creds/keys/lock rows have different shapes)
const WaAuthSchema = new Schema<any>({ _id: String, value: String, owner: String, until: Date }, { strict: false, timestamps: true })
export const WaAuth = model('WaAuth', WaAuthSchema, 'wa_auth')

export { Types }
export const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id)
export const isOid = (id: unknown): id is string => typeof id === 'string' && Types.ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id)
