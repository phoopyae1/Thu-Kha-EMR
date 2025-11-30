import { Router, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole, type AuthRequest } from '../modules/auth/index.js';
import { validate } from '../middleware/validate.js';
import {
  CreateLabOrderSchema,
  CreateProblemSchema,
  CreateVitalsSchema,
  EnterLabResultSchema,
  UpdateProblemStatusSchema,
} from '../validation/clinical.js';
import * as vitals from '../services/vitalsService.js';
import * as problems from '../services/problemService.js';
import * as labs from '../services/labService.js';

const router = Router();

// Vitals
router.post(
  '/vitals',
  requireAuth,
  requireRole('Nurse', 'Doctor', 'ITAdmin'),
  validate({ body: CreateVitalsSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const data = await vitals.createVitals(user.userId, req.body);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/patients/:patientId/vitals',
  requireAuth,
  requireRole('Nurse', 'Doctor', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
      const data = await vitals.listVitals(req.params.patientId, {
        limit: Number.isFinite(limit) ? limit : 50,
      });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

// Problems
router.post(
  '/problems',
  requireAuth,
  requireRole('Doctor', 'ITAdmin'),
  validate({ body: CreateProblemSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const data = await problems.addProblem(user.userId, req.body);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/patients/:patientId/problems',
  requireAuth,
  requireRole('Nurse', 'Doctor', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
      const data = await problems.listProblems(req.params.patientId, statusParam);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/problems/:problemId/status',
  requireAuth,
  requireRole('Doctor', 'ITAdmin'),
  validate({ body: UpdateProblemStatusSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await problems.updateProblemStatus(
        req.params.problemId,
        req.body.status,
        req.body.resolvedDate,
      );
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
);

// Lab Orders & Results
router.post(
  '/lab-orders',
  requireAuth,
  requireRole('Doctor', 'ITAdmin'),
  validate({ body: CreateLabOrderSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const data = await labs.createLabOrder(user.userId, req.body);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/lab-orders',
  requireAuth,
  requireRole('LabTech', 'Doctor', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filters = {
        patientId: typeof req.query.patientId === 'string' && req.query.patientId.length > 0
          ? req.query.patientId
          : undefined,
        visitId: typeof req.query.visitId === 'string' && req.query.visitId.length > 0
          ? req.query.visitId
          : undefined,
        status: typeof req.query.status === 'string' && req.query.status.length > 0
          ? req.query.status
          : undefined,
      };
      const data = await labs.listLabOrders(filters);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/lab-orders/:labOrderId',
  requireAuth,
  requireRole('LabTech', 'Doctor', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await labs.getLabOrderDetail(req.params.labOrderId);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/lab-orders/:labOrderId',
  requireAuth,
  requireRole('Doctor', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await labs.deleteLabOrder(req.params.labOrderId);
      res.json({ message: 'Lab order deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/lab-results',
  requireAuth,
  requireRole('LabTech', 'ITAdmin'),
  validate({ body: EnterLabResultSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const data = await labs.enterLabResult(user.userId, req.body);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/lab-orders/:labOrderId/report.pdf',
  requireAuth,
  requireRole('Doctor', 'LabTech', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const pdf = await labs.generateLabReportPdf(req.params.labOrderId);
      res.json({ ok: true, note: 'PDF generation stub', length: pdf.length });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
