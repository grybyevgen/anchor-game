import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import {
  runProductionForElapsedTicks,
  getProductionTicksSince,
  type PortInventory,
} from '../services/portProduction.js';

const router = Router();

/**
 * GET /api/ports
 * List all ports. Applies production ticks since last_production_at.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: rows, error } = await supabase
      .from('ports')
      .select('*')
      .order('id');

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const now = new Date();
    const results = [];

    for (const row of rows || []) {
      const ticks = getProductionTicksSince(row.last_production_at);
      let oil = row.oil;
      let materials = row.materials;
      let provisions = row.provisions;

      if (ticks > 0) {
        const inv: PortInventory = { oil: row.oil, materials: row.materials, provisions: row.provisions };
        const nextInv = runProductionForElapsedTicks(row.type, inv, ticks);
        oil = nextInv.oil;
        materials = nextInv.materials;
        provisions = nextInv.provisions;

        await supabase
          .from('ports')
          .update({
            oil,
            materials,
            provisions,
            last_production_at: now.toISOString(),
          })
          .eq('id', row.id);
      }

      results.push({
        id: row.id,
        name: row.name,
        type: row.type,
        x: Number(row.x),
        y: Number(row.y),
        inventory: { oil, materials, provisions },
      });
    }

    res.json(results);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
