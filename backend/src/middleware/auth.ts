import { Request, Response, NextFunction } from 'express';

export type CompanyIdLocals = { companyId?: string };

/**
 * Resolve company from header X-Company-Id (required for game endpoints).
 * Frontend stores company id after create and sends it with every request.
 */
export function requireCompanyId(
  req: Request & { companyId?: string },
  res: Response,
  next: NextFunction
): void {
  const companyId = req.headers['x-company-id'] as string | undefined;
  if (!companyId) {
    res.status(401).json({ error: 'Missing X-Company-Id header' });
    return;
  }
  req.companyId = companyId;
  next();
}

/**
 * Optional: resolve company if header present.
 */
export function optionalCompanyId(
  req: Request & { companyId?: string },
  _res: Response,
  next: NextFunction
): void {
  req.companyId = req.headers['x-company-id'] as string | undefined;
  next();
}
