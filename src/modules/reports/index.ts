import { Router, type Response } from 'express';
import { PrismaClient, Prisma, AppointmentStatus } from '@prisma/client';
import { requireAuth, type AuthRequest } from '../auth/index.js';

const prisma = new PrismaClient();
const router = Router();

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function daysAgo(reference: Date, days: number): Date {
  const copy = new Date(reference);
  copy.setDate(copy.getDate() - days);
  return copy;
}

function daysAhead(reference: Date, days: number): Date {
  const copy = new Date(reference);
  copy.setDate(copy.getDate() + days);
  return copy;
}

router.get('/summary', requireAuth, async (req: AuthRequest, res: Response) => {
  const today = startOfToday();
  const last30Days = daysAgo(today, 30);
  const last90Days = daysAgo(today, 90);
  const nextSevenDaysEnd = daysAhead(today, 7);
  nextSevenDaysEnd.setHours(23, 59, 59, 999);

  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Security: Doctors can only see their own reports
  // Admins can see all or filter by specific doctor
  let doctorId: string | null = null;
  if (user.role === 'Doctor') {
    // Doctors are restricted to their own data
    if (!user.doctorId) {
      return res.status(403).json({ error: 'Doctor profile not found' });
    }
    doctorId = user.doctorId;
  } else if (user.role === 'ITAdmin' || user.role === 'AdminAssistant') {
    // Admins can filter by doctorId from query parameter
    doctorId = typeof req.query.doctorId === 'string' && req.query.doctorId.trim() 
      ? req.query.doctorId.trim() 
      : null;
  } else {
    // Other roles don't have access to reports
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Build where clauses for doctor filtering
  const visitWhere = doctorId 
    ? { visitDate: { gte: last30Days }, doctorId }
    : { visitDate: { gte: last30Days } };
  
  const visit90DaysWhere = doctorId
    ? { visitDate: { gte: last90Days }, doctorId }
    : { visitDate: { gte: last90Days } };

  const appointmentStatuses: AppointmentStatus[] = ['Scheduled', 'CheckedIn', 'InProgress'];
  const appointmentWhere = doctorId
    ? {
        date: { gte: today, lte: nextSevenDaysEnd },
        status: { in: appointmentStatuses },
        doctorId,
      }
    : {
        date: { gte: today, lte: nextSevenDaysEnd },
        status: { in: appointmentStatuses },
      };

  // For patient count, count distinct patients from visits if doctorId is provided
  const patientCountWhere = doctorId
    ? { visits: { some: { doctorId } } }
    : {};

  const [
    totalPatients,
    totalDoctors,
    visitsLast30Days,
    upcomingAppointments,
    activePatients,
    visitsByDepartmentRows,
    topDiagnosesRows,
    labSummariesRows,
    monthlyVisitTrendRows,
  ] = await Promise.all([
    doctorId
      ? prisma.patient.count({ where: patientCountWhere })
      : prisma.patient.count(),
    prisma.doctor.count(),
    prisma.visit.count({ where: visitWhere }),
    prisma.appointment.count({ where: appointmentWhere }),
    prisma.visit
      .findMany({
        where: visit90DaysWhere,
        distinct: ['patientId'],
        select: { patientId: true },
      })
      .then((rows) => rows.length),
    doctorId
      ? prisma.$queryRaw<Array<{ department: string; visit_count: bigint; patient_count: bigint }>>(
          Prisma.sql`
            SELECT department,
                   COUNT(*) AS visit_count,
                   COUNT(DISTINCT "patientId") AS patient_count
            FROM "Visit"
            WHERE "visitDate" >= ${last90Days}
              AND "doctorId" = ${doctorId}::uuid
            GROUP BY department
            ORDER BY visit_count DESC, department ASC
          `,
        )
      : prisma.$queryRaw<Array<{ department: string; visit_count: bigint; patient_count: bigint }>>(
          Prisma.sql`
            SELECT department,
                   COUNT(*) AS visit_count,
                   COUNT(DISTINCT "patientId") AS patient_count
            FROM "Visit"
            WHERE "visitDate" >= ${last90Days}
            GROUP BY department
            ORDER BY visit_count DESC, department ASC
          `,
        ),
    doctorId
      ? prisma.diagnosis.groupBy({
          by: ['diagnosis'],
          where: {
            visit: { doctorId },
          },
          _count: { diagnosis: true },
          orderBy: { _count: { diagnosis: 'desc' } },
          take: 10,
        })
      : prisma.diagnosis.groupBy({
          by: ['diagnosis'],
          _count: { diagnosis: true },
          orderBy: { _count: { diagnosis: 'desc' } },
          take: 10,
        }),
    doctorId
      ? prisma.visitLabResult.groupBy({
          by: ['testName'],
          where: {
            testDate: { not: null },
            visit: { doctorId },
          },
          _count: { labId: true },
          _avg: { resultValue: true },
          _max: { testDate: true },
          orderBy: { _count: { labId: 'desc' } },
          take: 10,
        })
      : prisma.visitLabResult.groupBy({
          by: ['testName'],
          where: { testDate: { not: null } },
          _count: { labId: true },
          _avg: { resultValue: true },
          _max: { testDate: true },
          orderBy: { _count: { labId: 'desc' } },
          take: 10,
        }),
    doctorId
      ? prisma.$queryRaw<Array<{ month: Date; visit_count: bigint }>>(
          Prisma.sql`
            SELECT date_trunc('month', "visitDate") AS month,
                   COUNT(*) AS visit_count
            FROM "Visit"
            WHERE "visitDate" >= ${daysAgo(today, 180)}
              AND "doctorId" = ${doctorId}::uuid
            GROUP BY month
            ORDER BY month ASC
          `,
        )
      : prisma.$queryRaw<Array<{ month: Date; visit_count: bigint }>>(
          Prisma.sql`
            SELECT date_trunc('month', "visitDate") AS month,
                   COUNT(*) AS visit_count
            FROM "Visit"
            WHERE "visitDate" >= ${daysAgo(today, 180)}
            GROUP BY month
            ORDER BY month ASC
          `,
        ),
  ]);

  const visitsByDepartment = visitsByDepartmentRows.map((row) => ({
    department: row.department,
    visitCount: Number(row.visit_count),
    patientCount: Number(row.patient_count),
  }));

  const topDiagnoses = topDiagnosesRows.map((row) => ({
    diagnosis: row.diagnosis,
    count: row._count.diagnosis,
  }));

  const labSummaries = labSummariesRows.map((row) => ({
    testName: row.testName,
    tests: row._count.labId,
    averageValue: row._avg.resultValue ?? null,
    lastTestDate: row._max.testDate ? row._max.testDate.toISOString() : null,
  }));

  const monthlyVisitTrends = monthlyVisitTrendRows.map((row) => ({
    month: row.month.toISOString(),
    visitCount: Number(row.visit_count),
  }));

  res.json({
    totals: {
      patients: totalPatients,
      doctors: totalDoctors,
      activePatients,
      visitsLast30Days,
      upcomingAppointments,
    },
    visitsByDepartment,
    topDiagnoses,
    labSummaries,
    monthlyVisitTrends,
  });
});

export default router;

