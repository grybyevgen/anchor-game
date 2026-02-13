import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import { addWeeklyEarnings } from '../services/companyEarnings.js';
import { calculateCargoPrice } from '../services/priceCalculator.js';
import {
  SHIP_PRICES,
  REVENUE_BONUS,
  FUEL_COST_PER_TRIP,
  HEALTH_COST_PER_TRIP,
  MORALE_COST_PER_TRIP,
  BARGE_CARGO_CAPACITY,
  type ShipType,
} from '../types/index.js';
import { requireSessionToken } from '../middleware/auth.js';

const router = Router();
router.use(requireSessionToken);

const TRAVEL_TIME_SEC = 15;

function mapShip(row: any, position: any) {
  const cargo = position
    ? {
        oil: position.cargo_oil ?? 0,
        materials: position.cargo_materials ?? 0,
        provisions: position.cargo_provisions ?? 0,
      }
    : { oil: 0, materials: 0, provisions: 0 };

  if (!position) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      fuel: row.fuel,
      health: row.health,
      morale: row.morale,
      maxFuel: row.max_fuel,
      maxHealth: row.max_health,
      maxMorale: row.max_morale,
      position: null,
    };
  }

  let currentPosition = { x: Number(position.pos_x), y: Number(position.pos_y) };
  let remainingSeconds = 0;

  if (position.is_moving && position.dest_port_id) {
    const destX = Number(position.dest_x);
    const destY = Number(position.dest_y);

    if (position.departed_at) {
      const departedAt = new Date(position.departed_at).getTime();
      const elapsedSec = (Date.now() - departedAt) / 1000;

      if (elapsedSec >= TRAVEL_TIME_SEC) {
        remainingSeconds = 0;
        currentPosition = { x: destX, y: destY };
      } else {
        const progress = elapsedSec / TRAVEL_TIME_SEC;
        const startX = Number(position.pos_x);
        const startY = Number(position.pos_y);
        currentPosition = {
          x: startX + (destX - startX) * progress,
          y: startY + (destY - startY) * progress,
        };
        remainingSeconds = Math.max(0, TRAVEL_TIME_SEC - elapsedSec);
      }
    } else {
      // Legacy: departed_at отсутствует — считаем только что вышло
      remainingSeconds = TRAVEL_TIME_SEC;
    }
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    fuel: row.fuel,
    health: row.health,
    morale: row.morale,
    maxFuel: row.max_fuel,
    maxHealth: row.max_health,
    maxMorale: row.max_morale,
    position: {
      portId: position.port_id,
      previousPortId: position.previous_port_id,
      isMoving: position.is_moving,
      currentPosition,
      destination: position.dest_port_id
        ? { x: Number(position.dest_x), y: Number(position.dest_y) }
        : undefined,
      destinationPortId: position.dest_port_id,
      remainingSeconds,
      travelTimeSec: TRAVEL_TIME_SEC,
      cargo,
    },
  };
}

/**
 * GET /api/ships
 * List ships for company with positions and cargo.
 * Для судов в пути: авто-прибытие по истечении 15 сек, позиция считается на бекенде.
 */
router.get('/', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;

    const { data: ships, error: shipsErr } = await supabase
      .from('ships')
      .select('*')
      .eq('company_id', companyId);

    if (shipsErr) {
      res.status(500).json({ error: shipsErr.message });
      return;
    }

    if (!ships?.length) {
      res.json({ ships: [], ports: [] });
      return;
    }

    const { data: positions } = await supabase
      .from('ship_positions')
      .select('*')
      .in('ship_id', ships.map((s) => s.id));

    const posList = positions || [];
    const posMap = new Map(posList.map((p) => [p.ship_id, p]));

    // Auto-arrive: суда в пути дольше 15 сек считаются прибывшими
    for (const pos of posList) {
      if (!pos.is_moving || !pos.departed_at || !pos.dest_port_id) continue;
      const elapsedSec = (Date.now() - new Date(pos.departed_at).getTime()) / 1000;
      if (elapsedSec >= TRAVEL_TIME_SEC) {
        await supabase
          .from('ship_positions')
          .update({
            port_id: pos.dest_port_id,
            previous_port_id: pos.previous_port_id,
            is_moving: false,
            pos_x: pos.dest_x,
            pos_y: pos.dest_y,
            dest_port_id: null,
            dest_x: null,
            dest_y: null,
            departed_at: null,
          })
          .eq('ship_id', pos.ship_id);

        const updated = { ...pos };
        updated.port_id = pos.dest_port_id;
        updated.is_moving = false;
        updated.pos_x = pos.dest_x;
        updated.pos_y = pos.dest_y;
        updated.dest_port_id = null;
        updated.dest_x = null;
        updated.dest_y = null;
        updated.departed_at = null;
        posMap.set(pos.ship_id, updated);
      }
    }

    const { data: ports } = await supabase.from('ports').select('id, name, type, x, y, oil, materials, provisions');

    res.json({
      ships: ships.map((s) => mapShip(s, posMap.get(s.id))),
      ports: (ports || []).map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        x: Number(p.x),
        y: Number(p.y),
        inventory: { oil: p.oil, materials: p.materials, provisions: p.provisions },
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships
 * Buy ship. Body: { type: ShipType, name: string }
 * Ship spawns at first port (port1).
 */
router.post('/', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const { type, name } = req.body as { type?: ShipType; name?: string };

    if (!type || !['tanker', 'cargo', 'supply', 'barge'].includes(type)) {
      res.status(400).json({ error: 'Invalid ship type' });
      return;
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Ship name is required' });
      return;
    }

    const price = SHIP_PRICES[type as ShipType];
    const { data: company } = await supabase
      .from('companies')
      .select('coins, level')
      .eq('id', companyId)
      .single();

    if (!company || company.coins < price) {
      res.status(400).json({ error: 'Not enough coins' });
      return;
    }

    const maxFuel = type === 'barge' ? 100 : 100;
    const maxHealth = 100;
    const maxMorale = 100;
    const fuel = type === 'barge' ? 50 : 100;
    const health = type === 'barge' ? 50 : 100;
    const morale = type === 'barge' ? 50 : 100;

    const { data: port1 } = await supabase.from('ports').select('id, x, y').eq('id', 'port1').single();
    if (!port1) {
      res.status(500).json({ error: 'Port port1 not found' });
      return;
    }

    const { data: newShip, error: insertErr } = await supabase
      .from('ships')
      .insert({
        company_id: companyId,
        name: name.trim().slice(0, 50),
        type,
        fuel,
        health,
        morale,
        max_fuel: maxFuel,
        max_health: maxHealth,
        max_morale: maxMorale,
      })
      .select()
      .single();

    if (insertErr) {
      res.status(500).json({ error: insertErr.message });
      return;
    }

    await supabase.from('ship_positions').insert({
      ship_id: newShip.id,
      port_id: port1.id,
      pos_x: port1.x,
      pos_y: port1.y,
      is_moving: false,
      cargo_oil: 0,
      cargo_materials: 0,
      cargo_provisions: 0,
    });

    await supabase
      .from('companies')
      .update({ coins: company.coins - price })
      .eq('id', companyId);

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('*')
      .eq('ship_id', newShip.id)
      .single();

    res.status(201).json({ ship: mapShip(newShip, pos) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/send
 * Send ship to port. Body: { destinationPortId: string }
 */
router.post('/:id/send', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;
    const { destinationPortId } = req.body as { destinationPortId?: string };

    if (!destinationPortId) {
      res.status(400).json({ error: 'destinationPortId required' });
      return;
    }

    const { data: ship } = await supabase
      .from('ships')
      .select('*')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('*')
      .eq('ship_id', shipId)
      .single();

    if (!pos || pos.is_moving) {
      res.status(400).json({ error: 'Ship not in port or already moving' });
      return;
    }

    const { data: destPort } = await supabase
      .from('ports')
      .select('id, x, y')
      .eq('id', destinationPortId)
      .single();

    if (!destPort) {
      res.status(400).json({ error: 'Destination port not found' });
      return;
    }

    const fuelCost = FUEL_COST_PER_TRIP[ship.type as ShipType];
    const healthCost = HEALTH_COST_PER_TRIP[ship.type as ShipType];
    const moraleCost = MORALE_COST_PER_TRIP[ship.type as ShipType];

    if (ship.fuel < fuelCost) {
      res.status(400).json({ error: 'Not enough fuel' });
      return;
    }

    await supabase
      .from('ship_positions')
      .update({
        port_id: null,
        previous_port_id: pos.port_id,
        is_moving: true,
        dest_port_id: destPort.id,
        dest_x: destPort.x,
        dest_y: destPort.y,
        departed_at: new Date().toISOString(),
      })
      .eq('ship_id', shipId);

    await supabase
      .from('ships')
      .update({
        fuel: Math.max(0, ship.fuel - fuelCost),
        health: Math.max(0, ship.health - healthCost),
        morale: Math.max(0, ship.morale - moraleCost),
      })
      .eq('id', shipId);

    res.json({ ok: true, message: 'Ship sent' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/arrive
 * Mark ship arrived at destination (called by frontend after travel animation).
 */
router.post('/:id/arrive', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;

    const { data: ship } = await supabase
      .from('ships')
      .select('id')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('*')
      .eq('ship_id', shipId)
      .single();

    if (!pos || !pos.is_moving || !pos.dest_port_id) {
      res.status(400).json({ error: 'Ship is not moving' });
      return;
    }

    await supabase
      .from('ship_positions')
      .update({
        port_id: pos.dest_port_id,
        previous_port_id: pos.previous_port_id,
        is_moving: false,
        pos_x: pos.dest_x,
        pos_y: pos.dest_y,
        dest_port_id: null,
        dest_x: null,
        dest_y: null,
      })
      .eq('ship_id', shipId);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/load
 * Load cargo. Body: { cargoType: 'oil' | 'materials' | 'provisions', amount: number }
 */
router.post('/:id/load', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;
    const { cargoType, amount } = req.body as { cargoType?: string; amount?: number };

    if (!cargoType || !['oil', 'materials', 'provisions'].includes(cargoType) || typeof amount !== 'number' || amount < 1) {
      res.status(400).json({ error: 'Invalid cargoType or amount' });
      return;
    }

    const { data: ship } = await supabase
      .from('ships')
      .select('*')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('*')
      .eq('ship_id', shipId)
      .single();

    if (!pos || !pos.port_id || pos.is_moving) {
      res.status(400).json({ error: 'Ship must be in port' });
      return;
    }

    const { data: port } = await supabase
      .from('ports')
      .select('*')
      .eq('id', pos.port_id)
      .single();

    if (!port) {
      res.status(404).json({ error: 'Port not found' });
      return;
    }

    const portInv = port as any;
    const portAmount = portInv[cargoType] ?? 0;
    if (portAmount < amount) {
      res.status(400).json({ error: `Not enough cargo in port. Available: ${portAmount}` });
      return;
    }

    if (ship.type === 'barge') {
      const currentCargo = (pos.cargo_oil ?? 0) + (pos.cargo_materials ?? 0) + (pos.cargo_provisions ?? 0);
      if (currentCargo + amount > BARGE_CARGO_CAPACITY) {
        res.status(400).json({ error: `Barge max capacity ${BARGE_CARGO_CAPACITY}. Current: ${currentCargo}` });
        return;
      }
    } else {
      const allowed =
        (ship.type === 'tanker' && cargoType === 'oil' && port.type === 'oil') ||
        (ship.type === 'cargo' && cargoType === 'materials' && port.type === 'materials') ||
        (ship.type === 'supply' && cargoType === 'provisions' && port.type === 'provisions');
      if (!allowed) {
        res.status(400).json({ error: 'This ship can only load matching cargo at matching port' });
        return;
      }
    }

    const pricePerUnit = calculateCargoPrice(portAmount);
    const totalCost = pricePerUnit * amount;

    const { data: company } = await supabase
      .from('companies')
      .select('coins')
      .eq('id', companyId)
      .single();

    if (!company || company.coins < totalCost) {
      res.status(400).json({ error: 'Not enough coins' });
      return;
    }

    const cargoCol = `cargo_${cargoType === 'oil' ? 'oil' : cargoType === 'materials' ? 'materials' : 'provisions'}`;
    const portCol = cargoType;

    await supabase
      .from('ports')
      .update({ [portCol]: portInv[portCol] - amount })
      .eq('id', port.id);

    await supabase
      .from('ship_positions')
      .update({ [cargoCol]: (pos as any)[cargoCol] + amount })
      .eq('ship_id', shipId);

    await supabase
      .from('companies')
      .update({ coins: company.coins - totalCost })
      .eq('id', companyId);

    res.json({ ok: true, cost: totalCost });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/unload
 * Unload cargo. Must have moved from another port (previousPortId !== current port).
 */
router.post('/:id/unload', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;

    const { data: ship } = await supabase
      .from('ships')
      .select('*')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('*')
      .eq('ship_id', shipId)
      .single();

    if (!pos || !pos.port_id || pos.is_moving) {
      res.status(400).json({ error: 'Ship must be in port' });
      return;
    }

    if (!pos.previous_port_id || pos.previous_port_id === pos.port_id) {
      res.status(400).json({ error: 'Cannot unload in same port where loaded' });
      return;
    }

    const { data: port } = await supabase
      .from('ports')
      .select('*')
      .eq('id', pos.port_id)
      .single();

    if (!port) {
      res.status(404).json({ error: 'Port not found' });
      return;
    }

    const portInv = port as any;
    const cargoOil = pos.cargo_oil ?? 0;
    const cargoMat = pos.cargo_materials ?? 0;
    const cargoProv = pos.cargo_provisions ?? 0;

    let totalEarnings = 0;
    if (cargoOil > 0) totalEarnings += cargoOil * calculateCargoPrice(portInv.oil);
    if (cargoMat > 0) totalEarnings += cargoMat * calculateCargoPrice(portInv.materials);
    if (cargoProv > 0) totalEarnings += cargoProv * calculateCargoPrice(portInv.provisions);

    const { data: company } = await supabase
      .from('companies')
      .select('level, coins, completed_trips, total_cargo_units')
      .eq('id', companyId)
      .single();

    if (!company) {
      res.status(500).json({ error: 'Company not found' });
      return;
    }

    const bonus = REVENUE_BONUS[company.level] ?? 0;
    totalEarnings = Math.round(totalEarnings * (1 + bonus));
    const totalCargo = cargoOil + cargoMat + cargoProv;

    await addWeeklyEarnings(companyId, totalEarnings);

    await supabase
      .from('ports')
      .update({
        oil: portInv.oil + cargoOil,
        materials: portInv.materials + cargoMat,
        provisions: portInv.provisions + cargoProv,
      })
      .eq('id', port.id);

    await supabase
      .from('ship_positions')
      .update({
        cargo_oil: 0,
        cargo_materials: 0,
        cargo_provisions: 0,
      })
      .eq('ship_id', shipId);

    await supabase
      .from('companies')
      .update({
        coins: company.coins + totalEarnings,
        completed_trips: company.completed_trips + 1,
        total_cargo_units: (company.total_cargo_units ?? 0) + totalCargo,
      })
      .eq('id', companyId);

    res.json({ ok: true, earnings: totalEarnings, tripCompleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/refuel
 * Body: { amount: number }. Only in oil port. 1 fuel = 1 oil + cost.
 */
router.post('/:id/refuel', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;
    const { amount } = req.body as { amount?: number };

    if (typeof amount !== 'number' || amount < 1) {
      res.status(400).json({ error: 'Amount required' });
      return;
    }

    const { data: ship } = await supabase
      .from('ships')
      .select('*')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('port_id')
      .eq('ship_id', shipId)
      .single();

    const { data: oilPort } = await supabase
      .from('ports')
      .select('id, oil')
      .eq('type', 'oil')
      .single();

    if (!oilPort || pos?.port_id !== oilPort.id) {
      res.status(400).json({ error: 'Ship must be in oil port to refuel' });
      return;
    }

    if (oilPort.oil < amount) {
      res.status(400).json({ error: 'Not enough oil in port' });
      return;
    }

    const need = Math.min(amount, ship.max_fuel - ship.fuel);
    if (need < 1) {
      res.status(400).json({ error: 'Ship fuel already full' });
      return;
    }

    const pricePerUnit = calculateCargoPrice(oilPort.oil);
    const totalCost = pricePerUnit * need;

    const { data: company } = await supabase
      .from('companies')
      .select('coins')
      .eq('id', companyId)
      .single();

    if (!company || company.coins < totalCost) {
      res.status(400).json({ error: 'Not enough coins' });
      return;
    }

    await supabase
      .from('ships')
      .update({ fuel: ship.fuel + need })
      .eq('id', shipId);

    await supabase
      .from('ports')
      .update({ oil: oilPort.oil - need })
      .eq('id', oilPort.id);

    await supabase
      .from('companies')
      .update({ coins: company.coins - totalCost })
      .eq('id', companyId);

    res.json({ ok: true, amount: need, cost: totalCost });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/repair
 * Body: { amount: number }. Only in materials port. 1 HP = 1 material + cost.
 */
router.post('/:id/repair', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;
    const { amount } = req.body as { amount?: number };

    if (typeof amount !== 'number' || amount < 1) {
      res.status(400).json({ error: 'Amount required' });
      return;
    }

    const { data: ship } = await supabase
      .from('ships')
      .select('*')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('port_id')
      .eq('ship_id', shipId)
      .single();

    const { data: matPort } = await supabase
      .from('ports')
      .select('id, materials')
      .eq('type', 'materials')
      .single();

    if (!matPort || pos?.port_id !== matPort.id) {
      res.status(400).json({ error: 'Ship must be in materials port to repair' });
      return;
    }

    if (matPort.materials < amount) {
      res.status(400).json({ error: 'Not enough materials in port' });
      return;
    }

    const need = Math.min(amount, ship.max_health - ship.health);
    if (need < 1) {
      res.status(400).json({ error: 'Ship health already full' });
      return;
    }

    const pricePerUnit = calculateCargoPrice(matPort.materials);
    const totalCost = pricePerUnit * need;

    const { data: company } = await supabase
      .from('companies')
      .select('coins')
      .eq('id', companyId)
      .single();

    if (!company || company.coins < totalCost) {
      res.status(400).json({ error: 'Not enough coins' });
      return;
    }

    await supabase
      .from('ships')
      .update({ health: ship.health + need })
      .eq('id', shipId);

    await supabase
      .from('ports')
      .update({ materials: matPort.materials - need })
      .eq('id', matPort.id);

    await supabase
      .from('companies')
      .update({ coins: company.coins - totalCost })
      .eq('id', companyId);

    res.json({ ok: true, amount: need, cost: totalCost });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/morale
 * Body: { amount: number }. Only in provisions port. 1 morale = 1 provision + cost.
 */
router.post('/:id/morale', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;
    const { amount } = req.body as { amount?: number };

    if (typeof amount !== 'number' || amount < 1) {
      res.status(400).json({ error: 'Amount required' });
      return;
    }

    const { data: ship } = await supabase
      .from('ships')
      .select('*')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: pos } = await supabase
      .from('ship_positions')
      .select('port_id')
      .eq('ship_id', shipId)
      .single();

    const { data: provPort } = await supabase
      .from('ports')
      .select('id, provisions')
      .eq('type', 'provisions')
      .single();

    if (!provPort || pos?.port_id !== provPort.id) {
      res.status(400).json({ error: 'Ship must be in provisions port' });
      return;
    }

    if (provPort.provisions < amount) {
      res.status(400).json({ error: 'Not enough provisions in port' });
      return;
    }

    const need = Math.min(amount, ship.max_morale - ship.morale);
    if (need < 1) {
      res.status(400).json({ error: 'Ship morale already full' });
      return;
    }

    const pricePerUnit = calculateCargoPrice(provPort.provisions);
    const totalCost = pricePerUnit * need;

    const { data: company } = await supabase
      .from('companies')
      .select('coins')
      .eq('id', companyId)
      .single();

    if (!company || company.coins < totalCost) {
      res.status(400).json({ error: 'Not enough coins' });
      return;
    }

    await supabase
      .from('ships')
      .update({ morale: ship.morale + need })
      .eq('id', shipId);

    await supabase
      .from('ports')
      .update({ provisions: provPort.provisions - need })
      .eq('id', provPort.id);

    await supabase
      .from('companies')
      .update({ coins: company.coins - totalCost })
      .eq('id', companyId);

    res.json({ ok: true, amount: need, cost: totalCost });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/ships/:id/tow
 * Tow ship to oil port. Cost = 20 * oil price at oil port.
 */
router.post('/:id/tow', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const shipId = req.params.id;

    const { data: ship } = await supabase
      .from('ships')
      .select('id')
      .eq('id', shipId)
      .eq('company_id', companyId)
      .single();

    if (!ship) {
      res.status(404).json({ error: 'Ship not found' });
      return;
    }

    const { data: oilPort } = await supabase
      .from('ports')
      .select('id, x, y, oil')
      .eq('type', 'oil')
      .single();

    if (!oilPort) {
      res.status(500).json({ error: 'Oil port not found' });
      return;
    }

    const fuelPrice = calculateCargoPrice(oilPort.oil);
    const towCost = Math.round(20 * fuelPrice);

    const { data: company } = await supabase
      .from('companies')
      .select('coins')
      .eq('id', companyId)
      .single();

    if (!company || company.coins < towCost) {
      res.status(400).json({ error: 'Not enough coins for tow' });
      return;
    }

    await supabase
      .from('ship_positions')
      .update({
        port_id: oilPort.id,
        previous_port_id: null,
        is_moving: false,
        pos_x: oilPort.x,
        pos_y: oilPort.y,
        dest_port_id: null,
        dest_x: null,
        dest_y: null,
      })
      .eq('ship_id', shipId);

    await supabase
      .from('companies')
      .update({ coins: company.coins - towCost })
      .eq('id', companyId);

    res.json({ ok: true, cost: towCost });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
