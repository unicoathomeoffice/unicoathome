/* eslint-disable no-console */
// Seed master data, staff, patients and a day of realistic requests.
// Usage: npm run seed            (only when the database is empty)
//        npm run seed -- --reset (DROPS all Unico HomeCare collections first)
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import {
  Department,
  Designation,
  Zone,
  ServiceType,
  User,
  Patient,
  HomecareRequest,
  Vehicle,
  Notification,
  MessageLog,
  AuditLog,
  Counter,
  AssignmentLog,
  Note,
  ChatMessage,
  CarePlan,
  Prescription,
  LabResult,
  Approval,
  Session,
  Setting,
  Template,
  Attachment,
  CustomRole,
} from '../lib/models'
import { defaultPlatformAccess, ZONES, type Role } from '../lib/constants'

const reset = process.argv.includes('--reset')
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Unico@2026'
const MIN = 60_000
const now = Date.now()
const at = (minFromNow: number) => new Date(now + minFromNow * MIN)
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(d).replace(/-/g, '').slice(2)
/** Round to the nearest 15 minutes so scheduled times look human */
const slotAt = (minFromNow: number) => new Date(Math.round((now + minFromNow * MIN) / (15 * MIN)) * 15 * MIN)

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI missing (.env.local)')
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 })
  console.log('Connected to', mongoose.connection.name)

  if (await User.estimatedDocumentCount()) {
    if (!reset) {
      console.log('Database already has users. Run `npm run seed -- --reset` to wipe and reseed.')
      process.exit(0)
    }
  }
  if (reset) {
    const models = [Department, Designation, Zone, ServiceType, User, Patient, HomecareRequest, Vehicle, Notification, MessageLog, AuditLog, Counter, AssignmentLog, Note, ChatMessage, CarePlan, Prescription, LabResult, Approval, Session, Setting, Template, Attachment, CustomRole]
    for (const m of models) await m.deleteMany({})
    console.log('Cleared existing data')
  }
  for (const m of [User, Patient, HomecareRequest, Notification, MessageLog, AuditLog, ServiceType, Session]) await m.syncIndexes()

  // ------------------------------------------------------------ master data
  const depts = await Department.insertMany(
    [
      ['FM', 'Family Medicine'],
      ['NUR', 'Nursing'],
      ['LAB', 'Laboratory'],
      ['PHY', 'Physiotherapy'],
      ['TRN', 'Transport'],
      ['FO', 'Front Office'],
      ['IT', 'IT / Admin'],
    ].map(([code, name], i) => ({ code, name, sortOrder: i })),
  )
  const dept = (code: string) => depts.find((d) => d.code === code)!._id

  const desigRows: [string, string, string][] = [
    ['Consultant – Family Medicine', 'FM', 'G1'],
    ['Registrar – Family Medicine', 'FM', 'G2'],
    ['Medical Officer', 'FM', 'G3'],
    ['Home Care Coordinator', 'FM', 'G4'],
    ['Senior Staff Nurse', 'NUR', 'N1'],
    ['Staff Nurse', 'NUR', 'N2'],
    ['Medical Technologist (Lab)', 'LAB', 'T1'],
    ['Phlebotomist', 'LAB', 'T2'],
    ['Physiotherapist', 'PHY', 'P1'],
    ['Car Supervisor', 'TRN', 'S1'],
    ['Driver', 'TRN', 'S3'],
    ['Front Desk Executive', 'FO', 'F2'],
    ['IT Administrator', 'IT', 'I1'],
    ['Manager – Operations', 'FM', 'M1'],
  ]
  const desigs = await Designation.insertMany(desigRows.map(([title, d, grade], i) => ({ title, departmentId: dept(d), grade, sortOrder: i })))
  const desig = (t: string) => desigs.find((d) => d.title === t)!._id

  await Zone.insertMany(ZONES.map((name, i) => ({ name, travelBufferMin: ['Savar', 'Uttara', 'Bashundhara'].includes(name) ? 60 : 45, sortOrder: i })))

  const ck = (items: (string | [string, boolean])[]) =>
    items.map((x, i) => {
      const [label, mandatory] = Array.isArray(x) ? x : [x, true]
      return { key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label, mandatory, sortOrder: i }
    })
  const services = await ServiceType.insertMany([
    { code: 'DOCTOR_VISIT', name: "Doctor's consultation", category: 'Doctor', requiredSkills: ['consultation'], defaultDurationMin: 45, fee: 2500, vitalsRequired: ['bpSys', 'bpDia', 'pulse', 'spo2'], staffMix: [{ role: 'DOCTOR', count: 1 }], checklist: ck(['History', 'Examination', 'Vitals', 'Prescription', 'Advice', ['Follow-up plan', false]]) },
    { code: 'NURSING', name: 'Nursing care visit', category: 'Nursing', requiredSkills: [], defaultDurationMin: 45, fee: 1500, vitalsRequired: ['bpSys', 'bpDia', 'pulse', 'tempC', 'spo2'], staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Vitals', 'Medication given', 'Hygiene / care', ['Patient education', false]]) },
    { code: 'INJECTION_IV', name: 'Injection / IV infusion', category: 'Nursing', requiredSkills: ['injection', 'iv_cannulation'], defaultDurationMin: 40, fee: 1200, staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Verify prescription', 'Patient ID check', 'Administer', 'Observe 15 min', 'Document']) },
    { code: 'WOUND_DRESSING', name: 'Wound dressing', category: 'Nursing', requiredSkills: ['wound_care'], defaultDurationMin: 30, fee: 1200, staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Assess wound', 'Clean', 'Dress', 'Photo', ['Next dressing date', false]]) },
    { code: 'SAMPLE_COLLECTION', name: 'Sample collection', category: 'Lab', requiredSkills: ['sample_collection'], defaultDurationMin: 20, fee: 500, staffMix: [{ role: 'ALLIED', count: 1 }], checklist: ck(['Verify tests', 'Collect', 'Label', 'Cold chain', 'Hand over to lab', ['Report ETA', false]]) },
    { code: 'PHYSIO', name: 'Physiotherapy session', category: 'Physio', requiredSkills: ['physio_neuro'], defaultDurationMin: 45, fee: 1800, staffMix: [{ role: 'ALLIED', count: 1 }], checklist: ck(['Assessment', 'Exercises', ['Home programme', false]]) },
    { code: 'CATHETER_NG', name: 'Catheter / NG tube care', category: 'Nursing', requiredSkills: ['catheter_care'], defaultDurationMin: 30, fee: 1500, staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Check indication', 'Procedure', 'Document']) },
    { code: 'POST_OP', name: 'Post-operative care', category: 'Nursing', requiredSkills: ['wound_care'], defaultDurationMin: 45, fee: 2000, vitalsRequired: ['bpSys', 'bpDia', 'pulse', 'tempC', 'painScore'], staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Wound check', 'Vitals', 'Pain', 'Medication', 'Red-flag screen']) },
    { code: 'PALLIATIVE', name: 'Elderly / palliative care', category: 'Nursing', requiredSkills: ['palliative'], defaultDurationMin: 60, fee: 2200, staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Vitals', 'Comfort care', 'Medication', ['Family counselling', false]]) },
    { code: 'VACCINATION', name: 'Vaccination', category: 'Nursing', requiredSkills: ['vaccination'], defaultDurationMin: 20, fee: 800, staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Verify vaccine', 'Cold chain', 'Administer', 'Observe', 'Card update']) },
    { code: 'HEALTH_CHECK', name: 'Health check package', category: 'Doctor', requiredSkills: ['ecg'], defaultDurationMin: 40, fee: 3000, staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['BP', 'RBS', 'ECG', 'Weight', 'Report']) },
    { code: 'OXYGEN_NEB', name: 'Oxygen / nebulisation', category: 'Nursing', requiredSkills: [], defaultDurationMin: 30, fee: 900, staffMix: [{ role: 'NURSE', count: 1 }], checklist: ck(['Set up', 'Monitor SpO₂', 'Document']) },
    { code: 'ECG_HOME', name: 'ECG at home', category: 'Lab', requiredSkills: ['ecg'], defaultDurationMin: 25, fee: 1000, staffMix: [{ role: 'ALLIED', count: 1 }], checklist: ck(['Verify request', 'Prepare patient', '12-lead ECG', 'Upload tracing', ['Doctor review', false]]) },
  ].map((s, i) => ({ ...s, sortOrder: i })))
  const svc = (code: string) => services.find((s) => s.code === code)!

  // ------------------------------------------------------------ users
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  type U = [string, string, Role, string, string, string, string[], string[], string?]
  const rows: U[] = [
    ['A-0001', 'Rafiq Ahmed', 'SUPER_ADMIN', '01700000001', 'IT Administrator', 'IT', [], [], 'unicoathome.office@gmail.com'],
    ['N-0100', 'Nasrin Sultana', 'HC_ADMIN', '01711000100', 'Home Care Coordinator', 'FM', [], [], 'nasrin.sultana@unicohospitals.com'],
    ['FD-0201', 'Tanjina Akter', 'FRONT_DESK', '01711000201', 'Front Desk Executive', 'FO', [], [], 'frontdesk@unicohospitals.com'],
    ['V-0301', 'Dr. Kamrul Hasan', 'VIEWER', '01711000301', 'Manager – Operations', 'FM', [], [], 'kamrul.hasan@unicohospitals.com'],
    ['11289', 'Dr Md Abdur Rashid', 'DOCTOR', '01798908215', 'Registrar – Family Medicine', 'FM', ['consultation', 'ecg', 'palliative'], ['Dhanmondi', 'Mohammadpur', 'Motijheel']],
    ['N-0210', 'Dr. Farida Rahman', 'DOCTOR', '01711000210', 'Registrar – Family Medicine', 'FM', ['consultation', 'paediatric'], ['Uttara', 'Gulshan', 'Banani']],
    ['11301', 'Dr. Imran Chowdhury', 'DOCTOR', '01711001301', 'Consultant – Family Medicine', 'FM', ['consultation', 'ecg'], ['Gulshan', 'Banani', 'Bashundhara']],
    ['11432', 'Nasif Ahammed Niloy', 'NURSE', '01967327773', 'Senior Staff Nurse', 'NUR', ['injection', 'iv_cannulation', 'wound_care', 'sample_collection', 'catheter_care'], ['Dhanmondi', 'Mohammadpur', 'Mirpur']],
    ['11342', 'Umme Ara Nasima', 'NURSE', '01856465996', 'Staff Nurse', 'NUR', ['injection', 'wound_care', 'palliative', 'vaccination'], ['Banani', 'Gulshan', 'Badda']],
    ['11355', 'Sabina Akter', 'NURSE', '01711011355', 'Staff Nurse', 'NUR', ['wound_care', 'palliative', 'catheter_care'], ['Dhanmondi', 'Mohammadpur']],
    ['11360', 'Shahida Parvin', 'NURSE', '01711011360', 'Senior Staff Nurse', 'NUR', ['wound_care', 'injection', 'iv_cannulation'], ['Mirpur', 'Uttara']],
    ['11174', 'Md. Khairul Hasan', 'ALLIED', '01726983588', 'Phlebotomist', 'LAB', ['sample_collection', 'ecg'], ['Dhanmondi', 'Mohammadpur', 'Motijheel']],
    ['11527', 'Mst. Nipa Khatun', 'ALLIED', '01573279905', 'Medical Technologist (Lab)', 'LAB', ['sample_collection', 'ecg'], ['Mirpur', 'Uttara']],
    ['11480', 'Tanjim Hossain', 'ALLIED', '01711011480', 'Physiotherapist', 'PHY', ['physio_neuro'], ['Gulshan', 'Banani', 'Badda']],
    ['11490', 'Md. Rafiqul Islam', 'ALLIED', '01711011490', 'Physiotherapist', 'PHY', ['physio_neuro', 'paediatric'], ['Dhanmondi', 'Mohammadpur', 'Mirpur']],
    ['T-0031', 'Mokbul Hossain', 'TRANSPORT_SUPERVISOR', '01711000031', 'Car Supervisor', 'TRN', [], []],
    ['D-0041', 'Kamal Uddin', 'DRIVER', '01711000041', 'Driver', 'TRN', [], []],
    ['D-0042', 'Jashim Uddin', 'DRIVER', '01711000042', 'Driver', 'TRN', [], []],
    ['D-0043', 'Sohel Rana', 'DRIVER', '01711000043', 'Driver', 'TRN', [], []],
  ]
  const users = await User.insertMany(
    rows.map(([employeeId, name, role, phone, d, dp, skills, zones, email], i) => ({
      employeeId,
      name,
      username: name.toLowerCase().replace(/^(dr\.?|md\.?|mst\.?)\s+/, '').split(' ')[0],
      role,
      phone,
      whatsapp: phone,
      email,
      departmentId: dept(dp),
      designationId: desig(d),
      skills,
      zones,
      platformAccess: defaultPlatformAccess(role),
      shift: 'MORNING',
      availability: employeeId === '11360' ? 'ON_LEAVE' : 'ON_DUTY',
      status: 'ACTIVE',
      passwordHash,
      stats: { visitsMonth: 8 + ((i * 7) % 19), onTimePct: 82 + ((i * 5) % 17), avgRating: 4.3 + ((i % 5) / 10) },
      lastLoginAt: at(-60 * ((i % 6) + 1)),
    })),
  )
  const u = (emp: string) => users.find((x) => x.employeeId === emp)!
  const coordinator = u('N-0100')
  const supervisor = u('T-0031')

  const vehicles = await Vehicle.insertMany([
    { name: 'Car 1', plate: 'DHA-GA 11-2233', model: 'Toyota Noah', seats: 6, status: 'ON_TRIP', driverId: u('D-0041')._id, supervisorId: supervisor._id, odometerKm: 48210, fuelPct: 60, nextServiceKm: 50000 },
    { name: 'Car 2', plate: 'DHA-GA 14-0917', model: 'Toyota Noah', seats: 6, status: 'ON_TRIP', driverId: u('D-0042')._id, supervisorId: supervisor._id, odometerKm: 61004, fuelPct: 35, nextServiceKm: 62000 },
    { name: 'Car 3', plate: 'DHA-KHA 22-4410', model: 'Toyota Axio', seats: 4, status: 'FREE', driverId: u('D-0043')._id, supervisorId: supervisor._id, odometerKm: 22870, fuelPct: 80, nextServiceKm: 30000 },
    { name: 'Car 4', plate: 'DHA-GA 09-5561', model: 'Toyota Noah', seats: 6, status: 'IN_SERVICE', supervisorId: supervisor._id, odometerKm: 88412, statusNote: 'Toyota Uttara · back Sat', serviceNote: 'Oil + brakes' },
  ])
  for (const [emp, i] of [['D-0041', 0], ['D-0042', 1], ['D-0043', 2]] as const) await User.updateOne({ _id: u(emp)._id }, { vehicleId: vehicles[i]._id, supervisorId: supervisor._id, licenceNo: `DK-${4410 + i}-PRO`, licenceExpiry: new Date('2028-03-31') })

  // ------------------------------------------------------------ patients
  const P: [string, string, number, 'M' | 'F', string, string, string, string?, string[]?][] = [
    ['Abdul Karim', '01711234567', 68, 'M', 'Dhanmondi', 'House 21, Road 7/A', '104582', 'karim.family@gmail.com', ['Penicillin']],
    ['Nur Mohammad', '01819445566', 74, 'M', 'Banani', 'House 45, Road 11', '104611'],
    ['Salma Khatun', '01552778899', 61, 'F', 'Mirpur', 'Flat 4B, Block C, Section 10', '103998'],
    ['Hasan Mahmud', '01670112233', 55, 'M', 'Uttara', 'House 12, Road 5, Sector 7', '104120'],
    ['Rokeya Begum', '01912334455', 79, 'F', 'Mohammadpur', 'Block D, Iqbal Road', '102775', undefined, ['Sulfa drugs']],
    ['Jahanara Imam', '01711556677', 66, 'F', 'Gulshan', 'Road 90, House 7, Gulshan 2', '104705', 'jahanara.i@gmail.com'],
    ['Mizanur Rahman', '01799887766', 58, 'M', 'Dhanmondi', 'Road 27 (old), House 3', '104390'],
    ['Farhana Yasmin', '01633445566', 34, 'F', 'Bashundhara', 'Block F, Road 8, House 22', '104801'],
    ['Abul Kashem', '01822334411', 81, 'M', 'Motijheel', 'Arambagh, 14/2', '101234'],
    ['Shirin Akhter', '01744332211', 47, 'F', 'Mirpur', 'Section 2, Road 3, House 9', '104455'],
    ['Delwar Hossain', '01566778800', 72, 'M', 'Savar', 'Bank Colony, House 30', '103871'],
    ['Nasima Khanam', '01955667788', 63, 'F', 'Badda', 'Merul Badda, DIT Project Road 5', '104902'],
    ['Tariqul Islam', '01877665544', 39, 'M', 'Uttara', 'Sector 11, Road 16, House 44', '104933'],
    ['Maksuda Parvin', '01688990011', 70, 'F', 'Mohammadpur', 'Tajmahal Road, House 17', '104011'],
  ]
  const patients = await Patient.insertMany(
    P.map(([name, phone, ageYears, gender, area, full, uhid, email, allergies], i) => ({
      name,
      phone,
      ageYears,
      gender,
      uhid,
      email,
      allergies: allergies ?? [],
      conditions: [['Post-stroke', 'T2DM', 'HTN'], ['COPD'], ['CKD stage 3'], ['Post-op hernia repair'], ['Bedbound', 'Pressure ulcer'], ['T2DM'], ['IHD'], ['Pregnancy 28 wk'], ['Dementia'], ['Hypothyroid'], ['Parkinson disease'], ['Osteoarthritis'], ['Asthma'], ['HTN']][i],
      address: { area, full: `${full}, ${area}`, district: 'Dhaka' },
      addressHistory: [{ full: `${full}, ${area}`, area, from: at(-60 * 24 * 200) }],
      guardian: { name: ['Rashed Karim', 'Selim Mohammad', 'Rubel Hossain', 'Nadia Mahmud', 'Kamrun Nahar', 'Sabbir Imam', 'Lima Rahman', 'Arif Hasan', 'Jewel Kashem', 'Mamun Akhter', 'Tania Hossain', 'Riaz Khan', 'Sumi Islam', 'Babul Parvin'][i], relation: i % 3 ? 'Son' : 'Daughter', phone: `0171${String(3000000 + i * 1111).padStart(7, '0')}` },
      consent: { whatsapp: true, email: !!email, at: at(-60 * 24 * 30), by: coordinator._id },
      source: 'PHONE',
      createdBy: coordinator._id,
      createdAt: at(-60 * 24 * (30 + i * 9)),
    })),
  )
  const pt = (name: string) => patients.find((p) => p.name === name)!

  // ------------------------------------------------------------ requests
  const seq: Record<string, number> = {}
  const nextNo = (d: Date) => {
    const k = `HC-${ymd(d)}`
    seq[k] = (seq[k] ?? 0) + 1
    return `${k}-${String(seq[k]).padStart(4, '0')}`
  }
  const snapshot = (p: any) => ({ name: p.name, phone: p.phone, ageYears: p.ageYears, gender: p.gender, uhid: p.uhid, area: p.address.area, address: p.address.full })
  const svcs = (codes: string[]) => codes.map((c) => ({ serviceTypeId: svc(c)._id, code: c, name: svc(c).name }))
  const checklist = (codes: string[], doneUntil = 0, startAt?: Date, by?: any) => {
    const seen = new Set<string>()
    const list: any[] = []
    for (const c of codes)
      for (const it of svc(c).checklist as any[]) {
        if (seen.has(it.key)) continue
        seen.add(it.key)
        const i = list.length
        const done = i < doneUntil
        list.push({ key: it.key, label: it.label, mandatory: it.mandatory, done, doneAt: done && startAt ? new Date(startAt.getTime() + (i + 1) * 4 * MIN) : undefined, doneBy: done ? by : undefined })
      }
    return list
  }

  type Spec = {
    patient: string
    codes: string[]
    status: string
    priority?: 'ROUTINE' | 'URGENT' | 'EMERGENCY'
    sched: number // minutes from now
    requestedAgo: number // minutes before now
    staff?: string[]
    tests?: string[]
    transport?: 'car1' | 'car2' | 'own' | 'requested'
    complaint?: string
    doneUntil?: number
    checkInAgo?: number
    creator?: string
  }
  const specs: Spec[] = [
    { patient: 'Abdul Karim', codes: ['NURSING', 'SAMPLE_COLLECTION'], status: 'IN_PROGRESS', sched: -25, requestedAgo: 60 * 26, staff: ['11432', '11289'], tests: ['CBC With ESR', 'HbA1C', 'Fasting Lipid Profile'], transport: 'car1', complaint: 'Post-stroke nursing; review evening glycaemia', doneUntil: 3, checkInAgo: 21 },
    { patient: 'Mizanur Rahman', codes: ['WOUND_DRESSING'], status: 'EN_ROUTE', sched: 20, requestedAgo: 60 * 20, staff: ['11360'], complaint: 'Diabetic foot ulcer dressing, day 6', transport: 'own' },
    { patient: 'Rokeya Begum', codes: ['PALLIATIVE'], status: 'ACCEPTED', sched: 95, requestedAgo: 60 * 30, staff: ['11355'], complaint: 'Pressure ulcer care, comfort care' },
    { patient: 'Hasan Mahmud', codes: ['DOCTOR_VISIT'], status: 'ASSIGNED', priority: 'URGENT', sched: 70, requestedAgo: 50, staff: ['N-0210'], complaint: 'Fever 3 days with wound redness after hernia repair', transport: 'car2' },
    { patient: 'Nur Mohammad', codes: ['NURSING', 'OXYGEN_NEB'], status: 'CONFIRMED', sched: 150, requestedAgo: 40, complaint: 'COPD exacerbation follow-up, nebulisation', transport: 'requested' },
    { patient: 'Salma Khatun', codes: ['SAMPLE_COLLECTION'], status: 'CONFIRMED', sched: 180, requestedAgo: 35, tests: ['Serum Creatinine', 'Serum Electrolytes', 'CBC'], complaint: 'CKD monitoring bloods' },
    { patient: 'Jahanara Imam', codes: ['HEALTH_CHECK'], status: 'NEW', sched: 60 * 22, requestedAgo: 9, complaint: 'Annual health check at home', creator: 'FD-0201' },
    { patient: 'Abul Kashem', codes: ['DOCTOR_VISIT'], status: 'NEW', priority: 'URGENT', sched: 120, requestedAgo: 3, complaint: 'Confusion since morning, family worried', creator: 'FD-0201' },
    { patient: 'Farhana Yasmin', codes: ['SAMPLE_COLLECTION'], status: 'VERIFIED', sched: 60 * 20, requestedAgo: 25, tests: ['CBC', 'Urine Routine Examination', 'Thyroid Stimulating Hormone (TSH)'], complaint: 'Antenatal bloods' },
    { patient: 'Shirin Akhter', codes: ['PHYSIO'], status: 'COMPLETED', sched: -180, requestedAgo: 60 * 28, staff: ['11490'], complaint: 'Frozen shoulder physio session 3', doneUntil: 99, checkInAgo: 176 },
    { patient: 'Delwar Hossain', codes: ['PHYSIO'], status: 'COMPLETED', sched: -240, requestedAgo: 60 * 30, staff: ['11480'], complaint: 'Parkinson gait training', doneUntil: 99, checkInAgo: 232, transport: 'car2' },
    { patient: 'Maksuda Parvin', codes: ['INJECTION_IV'], status: 'CLOSED', sched: -300, requestedAgo: 60 * 27, staff: ['11342'], complaint: 'IV antibiotic day 3/5', doneUntil: 99, checkInAgo: 297 },
    { patient: 'Nasima Khanam', codes: ['NURSING'], status: 'CANCELLED', sched: 60, requestedAgo: 60 * 5, complaint: 'Family admitted patient to hospital' },
    { patient: 'Tariqul Islam', codes: ['VACCINATION'], status: 'RESCHEDULED', sched: 60 * 24 + 60, requestedAgo: 60 * 8, complaint: 'Influenza vaccine' },
    { patient: 'Abdul Karim', codes: ['NURSING'], status: 'CONFIRMED', sched: 60 * 48, requestedAgo: 60 * 26, complaint: 'Care plan visit · post-stroke nursing' },
  ]

  const created: any[] = []
  for (const s of specs) {
    const p = pt(s.patient)
    const requestedAt = at(-s.requestedAgo)
    const scheduledAt = slotAt(s.sched)
    const order = ['NEW', 'VERIFIED', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']
    const reached = (st: string) => order.indexOf(s.status) >= order.indexOf(st)
    const staffIds = (s.staff ?? []).map((e) => u(e)._id)
    const confirmedAt = reached('CONFIRMED') || ['RESCHEDULED', 'CANCELLED'].includes(s.status) ? new Date(requestedAt.getTime() + 11 * MIN) : undefined
    const assignedAt = reached('ASSIGNED') ? new Date(Math.min(now - 5 * MIN, requestedAt.getTime() + 34 * MIN)) : undefined
    const acceptedAt = reached('ACCEPTED') && assignedAt ? new Date(assignedAt.getTime() + 6 * MIN) : undefined
    const checkInAt = s.checkInAgo != null ? at(-s.checkInAgo) : undefined
    const duration = s.status === 'IN_PROGRESS' ? undefined : s.codes.reduce((a, c) => Math.max(a, svc(c).defaultDurationMin), 0) + 3
    const checkOutAt = checkInAt && duration ? new Date(checkInAt.getTime() + duration * MIN) : undefined
    const completedAt = reached('COMPLETED') && checkOutAt ? new Date(checkOutAt.getTime() + 2 * MIN) : undefined
    const fee = s.codes.reduce((a, c) => a + svc(c).fee, 0)
    const primary = staffIds[0]
    const createdAt = requestedAt
    const car = s.transport === 'car1' ? vehicles[0] : s.transport === 'car2' ? vehicles[1] : null
    const r = await HomecareRequest.create({
      requestNo: nextNo(requestedAt),
      patientId: p._id,
      patientSnapshot: snapshot(p),
      requester: { type: 'RELATIVE', name: (p as any).guardian?.name, relation: (p as any).guardian?.relation, phone: (p as any).guardian?.phone },
      services: svcs(s.codes),
      tests: s.tests ?? [],
      priority: s.priority ?? 'ROUTINE',
      status: s.status,
      preferred: { date: undefined, slot: undefined },
      scheduledAt,
      expectedDurationMin: s.codes.reduce((a, c) => Math.max(a, svc(c).defaultDurationMin), 0),
      clinical: { complaint: s.complaint, allergies: p.allergies },
      assignment: primary
        ? { teamSize: staffIds.length, primaryStaffId: primary, secondaryStaffIds: staffIds.slice(1), assignedBy: coordinator._id, assignedAt, acceptedAt, respondBy: s.status === 'ASSIGNED' ? at(12) : undefined, instructions: s.status === 'IN_PROGRESS' ? 'Son will meet you at the gate. Dog in the house.' : undefined }
        : { teamSize: 1 },
      timeline: {
        requestedAt,
        verifiedAt: reached('VERIFIED') ? new Date(requestedAt.getTime() + 6 * MIN) : undefined,
        confirmedAt,
        assignedAt,
        acceptedAt,
        enRouteAt: reached('EN_ROUTE') ? (checkInAt ? new Date(checkInAt.getTime() - 25 * MIN) : at(-8)) : undefined,
        checkInAt,
        checkOutAt: reached('COMPLETED') ? checkOutAt : undefined,
        completedAt,
        closedAt: s.status === 'CLOSED' && completedAt ? new Date(completedAt.getTime() + 40 * MIN) : undefined,
        cancelledAt: s.status === 'CANCELLED' ? at(-60) : undefined,
        rescheduledAt: s.status === 'RESCHEDULED' ? at(-90) : undefined,
      },
      visit: {
        checklist: checklist(s.codes, s.doneUntil ?? 0, checkInAt, primary),
        checkIn: checkInAt ? { at: checkInAt } : undefined,
        checkOut: reached('COMPLETED') && checkOutAt ? { at: checkOutAt } : undefined,
        vitals: checkInAt ? { bpSys: 138, bpDia: 86, pulse: 84, tempC: 36.9, spo2: 96, rbs: s.patient === 'Abdul Karim' ? 11.2 : 6.4, recordedAt: new Date(checkInAt.getTime() + 8 * MIN), recordedBy: primary, abnormal: s.patient === 'Abdul Karim' ? ['rbs'] : [], flagged: s.patient === 'Abdul Karim' } : undefined,
        notes: reached('COMPLETED') ? { nursing: 'Patient stable. Exercises tolerated well. Family educated on home programme.', updatedAt: checkOutAt } : undefined,
        medications: s.patient === 'Maksuda Parvin' ? [{ drug: 'Ceftriaxone', dose: '1 g', route: 'IV', time: '09:40', by: primary, at: checkInAt }] : [],
        confirmation: reached('COMPLETED') ? { type: 'PAD', at: checkOutAt, relation: 'Son', name: (p as any).guardian?.name } : undefined,
        durationMin: reached('COMPLETED') ? duration : undefined,
        lateMin: checkInAt ? Math.max(0, Math.round((checkInAt.getTime() - scheduledAt.getTime()) / MIN)) : undefined,
        reportAt: completedAt,
      },
      transport: car
        ? { needed: true, mode: 'UNICO_CAR', status: s.status === 'COMPLETED' ? 'DONE' : 'ASSIGNED', vehicleId: car._id, driverId: car.driverId, pickupAt: new Date(scheduledAt.getTime() - 40 * MIN), returnAt: new Date(scheduledAt.getTime() + 120 * MIN), assignedBy: supervisor._id, assignedAt: at(-120), legs: [
            { key: 'pickup', label: 'Pick up team at hospital', plannedAt: new Date(scheduledAt.getTime() - 40 * MIN), at: s.sched < 30 ? new Date(scheduledAt.getTime() - 38 * MIN) : undefined },
            { key: 'drive', label: `Drive to patient · ${p.address!.area}`, plannedAt: scheduledAt, at: checkInAt ? new Date(checkInAt.getTime() - 2 * MIN) : undefined },
            { key: 'wait', label: 'Wait during visit' },
            { key: 'return', label: 'Return to hospital', plannedAt: new Date(scheduledAt.getTime() + 120 * MIN) },
          ] }
        : s.transport === 'own'
          ? { needed: true, mode: 'RICKSHAW', status: 'OWN' }
          : s.transport === 'requested'
            ? { needed: true, status: 'REQUESTED' }
            : { needed: false },
      pettyCash: s.patient === 'Abdul Karim' && s.status === 'IN_PROGRESS' ? [{ amount: 250, purpose: 'Consumables', note: 'Extra dressing pack', requestedBy: primary, requestedAt: at(-6), status: 'PENDING' }] : [],
      billing: {
        estimatedFee: fee,
        billAmount: reached('COMPLETED') ? fee : undefined,
        status: reached('COMPLETED') ? (s.patient === 'Delwar Hossain' ? 'DUE' : 'PAID') : undefined,
        method: reached('COMPLETED') ? 'CASH' : undefined,
        collectedBy: reached('COMPLETED') ? primary : undefined,
        invoiceNo: s.status === 'CLOSED' ? `INV-${ymd(requestedAt)}-018` : undefined,
        invoiceAmount: s.status === 'CLOSED' ? fee : undefined,
        invoicePrinted: s.status === 'CLOSED' ? true : undefined,
      },
      cancellation: s.status === 'CANCELLED' ? { reason: 'Patient admitted to hospital', by: coordinator._id, at: at(-60) } : undefined,
      reschedules: s.status === 'RESCHEDULED' ? [{ from: at(60 * 3), to: scheduledAt, reason: 'Patient asked to move', by: coordinator._id, at: at(-90) }] : [],
      source: s.creator ? 'PHONE' : 'WHATSAPP',
      createdBy: s.creator ? u(s.creator)._id : coordinator._id,
      createdAt,
    })
    created.push(r)
    if (primary && assignedAt) await AssignmentLog.create({ requestId: r._id, toStaffId: primary, action: 'ASSIGN', by: coordinator._id, at: assignedAt })
    if (acceptedAt) await AssignmentLog.create({ requestId: r._id, toStaffId: primary, action: 'ACCEPT', by: primary, at: acceptedAt })
    await AuditLog.create({ actorId: s.creator ? u(s.creator)._id : coordinator._id, actorName: s.creator ? u(s.creator).name : coordinator.name, actorRole: s.creator ? 'FRONT_DESK' : 'HC_ADMIN', action: 'request.create', entity: 'request', entityId: String(r._id), entityLabel: r.requestNo, after: { requestNo: r.requestNo, patient: p.name, services: s.codes }, client: 'web', serverAt: requestedAt })
    if (confirmedAt) await AuditLog.create({ actorId: coordinator._id, actorName: coordinator.name, actorRole: 'HC_ADMIN', action: 'request.confirm', entity: 'request', entityId: String(r._id), entityLabel: r.requestNo, before: { status: 'NEW' }, after: { status: 'CONFIRMED', scheduledAt }, client: 'web', serverAt: confirmedAt })
  }

  // ------------------------------------------------------------ history: 14 days of closed visits for charts & reports
  const histStaff = ['11432', '11342', '11355', '11289', '11174', '11527', '11480', '11490', 'N-0210']
  const histCodes = ['NURSING', 'WOUND_DRESSING', 'PHYSIO', 'SAMPLE_COLLECTION', 'DOCTOR_VISIT', 'INJECTION_IV', 'PALLIATIVE', 'VACCINATION']
  const history: any[] = []
  for (let d = 14; d >= 1; d--) {
    const n = 4 + ((d * 7) % 6)
    for (let k = 0; k < n; k++) {
      const p = patients[(d * 3 + k) % patients.length]
      const code = histCodes[(d + k * 3) % histCodes.length]
      const staff = u(histStaff[(d + k) % histStaff.length])
      const scheduledAt = new Date(now - d * 86400_000 - (6 - k) * 60 * MIN)
      const requestedAt = new Date(scheduledAt.getTime() - 20 * 60 * MIN)
      const confirmedAt = new Date(requestedAt.getTime() + (6 + ((d + k) % 14)) * MIN)
      const assignedAt = new Date(confirmedAt.getTime() + (12 + ((d * k) % 25)) * MIN)
      const acceptedAt = new Date(assignedAt.getTime() + (3 + (k % 9)) * MIN)
      const late = (d + k) % 7 === 0 ? 14 : (d + k) % 3
      const checkInAt = new Date(scheduledAt.getTime() + late * MIN)
      const dur = svc(code).defaultDurationMin + (((d + k) % 5) - 2) * 4
      const checkOutAt = new Date(checkInAt.getTime() + dur * MIN)
      const cancelled = (d + k) % 11 === 0
      const fee = svc(code).fee
      history.push({
        requestNo: nextNo(requestedAt),
        patientId: p._id,
        patientSnapshot: snapshot(p),
        services: svcs([code]),
        priority: (d + k) % 9 === 0 ? 'URGENT' : 'ROUTINE',
        status: cancelled ? 'CANCELLED' : 'CLOSED',
        scheduledAt,
        expectedDurationMin: svc(code).defaultDurationMin,
        assignment: cancelled ? { teamSize: 1, declines: (d + k) % 4 === 0 ? [{ staffId: staff._id, reason: 'Too far', at: assignedAt }] : [] } : { teamSize: 1, primaryStaffId: staff._id, assignedBy: coordinator._id, assignedAt, acceptedAt, declines: [] },
        timeline: cancelled ? { requestedAt, confirmedAt, cancelledAt: new Date(confirmedAt.getTime() + 60 * MIN) } : { requestedAt, verifiedAt: confirmedAt, confirmedAt, assignedAt, acceptedAt, enRouteAt: new Date(checkInAt.getTime() - 30 * MIN), checkInAt, checkOutAt, completedAt: checkOutAt, closedAt: new Date(checkOutAt.getTime() + 90 * MIN) },
        visit: cancelled ? { checklist: [] } : { checklist: checklist([code], 99, checkInAt, staff._id), checkIn: { at: checkInAt }, checkOut: { at: checkOutAt }, durationMin: dur, lateMin: late, confirmation: { type: 'PAD', at: checkOutAt }, reportAt: checkOutAt },
        billing: cancelled ? { estimatedFee: fee } : { estimatedFee: fee, billAmount: fee, status: 'PAID', method: (['CASH', 'BKASH', 'NAGAD', 'CARD'] as const)[(d + k) % 4], collectedBy: staff._id, invoiceNo: `INV-${ymd(requestedAt)}-${String(k + 1).padStart(3, '0')}`, invoiceAmount: fee, invoicePrinted: (d + k) % 5 !== 0 },
        transport: { needed: (d + k) % 2 === 0, mode: (d + k) % 2 === 0 ? 'UNICO_CAR' : (['RICKSHAW', 'UBER', 'PATHAO'] as const)[k % 3], status: 'DONE', vehicleId: (d + k) % 2 === 0 ? vehicles[k % 3]._id : undefined, driverId: (d + k) % 2 === 0 ? vehicles[k % 3].driverId : undefined },
        cancellation: cancelled ? { reason: 'Patient postponed', by: coordinator._id, at: new Date(confirmedAt.getTime() + 60 * MIN) } : undefined,
        feedback: cancelled ? undefined : { rating: 4 + ((d + k) % 2), at: checkOutAt },
        source: (['PHONE', 'WHATSAPP', 'WALK_IN', 'APP'] as const)[k % 4],
        createdBy: coordinator._id,
        createdAt: requestedAt,
      })
    }
  }
  await HomecareRequest.insertMany(history)
  for (const [k, n] of Object.entries(seq)) await Counter.updateOne({ key: k }, { seq: n }, { upsert: true })

  // ------------------------------------------------------------ collaboration: notes, chat, care plan, prescription, labs, approvals
  const live = created[0] // Abdul Karim in progress
  const niloy = u('11432')
  await Note.insertMany([
    { authorId: niloy._id, type: 'PATIENT', text: 'Son prefers visits after 15:30. Keep the gate code: 2211.', patientId: live.patientId, requestId: live._id, tags: ['Family'], visibility: 'TEAM', createdAt: at(-60 * 24) },
    { authorId: coordinator._id, type: 'HANDOVER', text: 'Evening team: Mr Karim RBS was 11.2 today. Dr Rashid adjusting insulin. Please recheck tomorrow.', patientId: live.patientId, visibility: 'TEAM', tags: ['Handover'], createdAt: at(-15) },
    { authorId: u('11342')._id, type: 'GENERAL', text: 'Dressing packs running low in the home-care bag, requested from store.', visibility: 'COORDINATOR', tags: ['Supplies'], createdAt: at(-60 * 3) },
  ])
  await ChatMessage.insertMany([
    { requestId: live._id, senderId: coordinator._id, kind: 'TEXT', text: 'Hi Nasif, patient’s son called — they’d prefer you come after 15:30. Is that OK?', createdAt: at(-120) },
    { requestId: live._id, senderId: niloy._id, kind: 'TEXT', text: 'Yes fine. Car 1 pick-up is 14:20, can we push to 14:50?', createdAt: at(-117) },
    { requestId: live._id, senderId: coordinator._id, kind: 'TEXT', text: 'Asked Mokbul, Car 1 moved. Patient informed.', createdAt: at(-113) },
    { requestId: live._id, kind: 'SYSTEM', text: 'Schedule changed · system', createdAt: at(-112) },
    { requestId: live._id, senderId: niloy._id, kind: 'TEXT', text: 'Prescription photo from the son for the lipid profile.', createdAt: at(-20) },
  ])
  const plan = await CarePlan.create({ patientId: live.patientId, title: 'Post-stroke nursing', serviceTypeId: svc('NURSING')._id, daysOfWeek: [1, 3, 5], slot: '15–17', time: '15:00', startDate: at(-60 * 24 * 10), weeks: 4, orderedBy: 'Dr. Imran Chowdhury', status: 'ACTIVE', requestIds: [live._id, created[14]._id], createdBy: coordinator._id })
  await HomecareRequest.updateMany({ _id: { $in: [live._id, created[14]._id] } }, { carePlanId: plan._id })
  await Prescription.create({ requestId: live._id, patientId: live.patientId, doctorId: u('11289')._id, dx: 'Post-stroke, T2DM with poor evening glycaemic control, HTN', items: [{ drug: 'Mixtard 30', dose: '20 U SC before dinner (up from 18)', duration: '30 days' }, { drug: 'Amlodipine 5 mg', dose: '1 tab morning', duration: '30 days' }, { drug: 'Aspirin 75 mg', dose: '1 tab after lunch', duration: 'continue' }], advice: 'Check RBS before dinner daily. Review in 2 weeks with lipid results.', status: 'DRAFT' })
  await LabResult.insertMany([
    { requestId: live._id, patientId: live.patientId, test: 'HbA1C', value: '8.1', unit: '%', refRange: '< 6.5', flag: 'HIGH', status: 'RESULTED', resultedAt: at(-10), by: u('11174')._id },
    { requestId: live._id, patientId: live.patientId, test: 'CBC With ESR', summary: 'Normal · ESR 18', flag: 'NORMAL', status: 'RESULTED', resultedAt: at(-10), by: u('11174')._id },
    { requestId: live._id, patientId: live.patientId, test: 'Fasting Lipid Profile', status: 'PENDING', eta: at(60 * 18) },
  ])
  const pc = (await HomecareRequest.findById(live._id).lean<any>())!.pettyCash[0]
  await Approval.insertMany([
    { type: 'PETTY_CASH', requestId: live._id, payload: { pettyCashId: pc._id, amount: 250, purpose: 'Consumables' }, reason: 'Extra dressing pack', requestedBy: niloy._id, createdAt: at(-6) },
    { type: 'RESCHEDULE', requestId: created[2]._id, payload: { proposedSlot: '17–19', patientInformed: true }, reason: 'Previous visit running late', note: 'Running 40 min late from Banani, can reach by 17:15.', requestedBy: u('11355')._id, createdAt: at(-12) },
    { type: 'SERVICE_PROPOSAL', payload: { name: 'Home ECG + doctor review', fee: 1800 }, reason: 'Frequent requests from cardiology follow-ups', requestedBy: u('11289')._id, createdAt: at(-60 * 20) },
  ])

  // ------------------------------------------------------------ notifications & message logs
  const hc = coordinator._id
  await Notification.insertMany([
    { userId: hc, type: 'REQUEST_CREATED', title: `URGENT request ${created[7].requestNo}`, body: 'Abul Kashem · Doctor’s consultation · by Tanjina Akter', priority: 'high', data: { requestId: created[7]._id, url: `/requests/${created[7]._id}` }, createdAt: at(-3) },
    { userId: hc, type: 'ABNORMAL_VITALS', title: 'Abnormal vitals · Abdul Karim', body: `${live.requestNo} · RBS 11.2`, priority: 'high', data: { requestId: live._id, url: `/requests/${live._id}` }, createdAt: at(-13) },
    { userId: hc, type: 'CHECK_IN', title: 'Nasif Ahammed Niloy checked in', body: `${live.requestNo} · Abdul Karim`, data: { requestId: live._id, url: `/requests/${live._id}` }, createdAt: at(-21) },
    { userId: hc, type: 'APPROVAL', title: 'Petty cash ৳250 · ' + live.requestNo, body: 'Nasif Ahammed Niloy · Consumables', data: { requestId: live._id, url: '/settings/approvals' }, createdAt: at(-6) },
    { userId: hc, type: 'COMPLETED', title: `${created[9].requestNo} completed`, body: 'Md. Rafiqul Islam · Shirin Akhter · report ready', data: { requestId: created[9]._id, url: `/requests/${created[9]._id}` }, createdAt: at(-130), readAt: at(-100) },
    { userId: niloy._id, type: 'ASSIGNED', title: `New visit ${live.requestNo}`, body: 'Abdul Karim · Nursing care visit · Dhanmondi', priority: 'high', data: { requestId: live._id, url: `/m/visits/${live._id}` }, createdAt: at(-60 * 20), readAt: at(-60 * 19) },
    { userId: niloy._id, type: 'TRANSPORT', title: 'Car 1 · DHA-GA 11-2233 for ' + live.requestNo, body: 'Pick-up at hospital · Dhanmondi', data: { requestId: live._id, url: `/m/visits/${live._id}` }, createdAt: at(-120) },
    { userId: niloy._id, type: 'CHAT', title: 'Nasrin Sultana', body: 'Asked Mokbul, Car 1 moved. Patient informed.', data: { requestId: live._id, url: `/m/visits/${live._id}/chat` }, createdAt: at(-113) },
    { userId: u('N-0210')._id, type: 'ASSIGNED', title: `New visit ${created[3].requestNo} · respond in 15 min`, body: 'Hasan Mahmud · Doctor’s consultation · Uttara', priority: 'high', data: { requestId: created[3]._id, url: `/m/visits/${created[3]._id}` }, createdAt: at(-4) },
  ])
  await MessageLog.insertMany([
    { channel: 'WHATSAPP', provider: 'wa_deeplink', to: '8801711234567', toName: 'Abdul Karim', templateKey: 'patient_assigned', renderedText: 'Dear Abdul Karim, Nasif Ahammed Niloy (Senior Staff Nurse) has been assigned to your visit.', requestId: live._id, patientId: live.patientId, initiatedBy: hc, status: 'SENT_CONFIRMED', events: [{ status: 'PREPARED', at: at(-60 * 19) }, { status: 'SENT_CONFIRMED', at: at(-60 * 19 + 1) }], at: at(-60 * 19) },
    { channel: 'EMAIL', provider: 'gmail_smtp', to: 'karim.family@gmail.com', toName: 'Abdul Karim', subject: `Your home care visit is confirmed · ${live.requestNo}`, templateKey: 'patient_confirmed', renderedText: 'Dear Abdul Karim, your home care request is confirmed.', requestId: live._id, patientId: live.patientId, initiatedBy: hc, status: 'SENT', events: [{ status: 'QUEUED', at: at(-60 * 25) }, { status: 'SENT', at: at(-60 * 25 + 1) }], at: at(-60 * 25) },
    { channel: 'EMAIL', provider: 'gmail_smtp', to: 'jahanara.i@gmail.com', toName: 'Jahanara Imam', subject: 'Your home care visit is confirmed', templateKey: 'patient_confirmed', renderedText: 'Dear Jahanara Imam, your home care request is confirmed.', patientId: pt('Jahanara Imam')._id, initiatedBy: hc, status: 'FAILED', error: 'Invalid login: 535-5.7.8 Username and Password not accepted', attempts: 3, events: [{ status: 'QUEUED', at: at(-60 * 30) }, { status: 'FAILED', at: at(-60 * 30 + 1) }], at: at(-60 * 30) },
  ])

  console.log(`\nSeeded: ${users.length} users · ${patients.length} patients · ${created.length + history.length} requests · ${services.length} service types · ${vehicles.length} cars`)
  console.log(`\nAll accounts use password: ${PASSWORD}`)
  console.log('  Web  (/login)   A-0001 super admin · N-0100 coordinator · FD-0201 front desk · V-0301 viewer')
  console.log('  App  (/m/login) 11432 nurse · 11289 doctor · 11174 phlebotomist · T-0031 car supervisor · D-0041 driver')
  await mongoose.disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await mongoose.disconnect()
  process.exit(1)
})
