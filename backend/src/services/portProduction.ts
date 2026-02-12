/**
 * Port production every 5 seconds:
 * - oil: 1 materials + 1 provisions -> 3 oil
 * - materials: 1 oil + 1 provisions -> 3 materials
 * - provisions: 1 oil + 1 materials -> 3 provisions
 */
const PRODUCTION_INTERVAL_MS = 5000;

export interface PortInventory {
  oil: number;
  materials: number;
  provisions: number;
}

export function runProductionTick(
  type: 'oil' | 'materials' | 'provisions',
  inventory: PortInventory
): PortInventory | null {
  const next = { ...inventory };
  let produced = false;

  if (type === 'oil') {
    if (inventory.materials >= 1 && inventory.provisions >= 1) {
      next.materials -= 1;
      next.provisions -= 1;
      next.oil += 3;
      produced = true;
    }
  } else if (type === 'materials') {
    if (inventory.oil >= 1 && inventory.provisions >= 1) {
      next.oil -= 1;
      next.provisions -= 1;
      next.materials += 3;
      produced = true;
    }
  } else {
    if (inventory.oil >= 1 && inventory.materials >= 1) {
      next.oil -= 1;
      next.materials -= 1;
      next.provisions += 3;
      produced = true;
    }
  }

  return produced ? next : null;
}

/**
 * Run production for elapsed time (number of 5-second ticks).
 */
export function runProductionForElapsedTicks(
  type: 'oil' | 'materials' | 'provisions',
  inventory: PortInventory,
  ticks: number
): PortInventory {
  let current = { ...inventory };
  for (let i = 0; i < ticks; i++) {
    const next = runProductionTick(type, current);
    if (!next) break;
    current = next;
  }
  return current;
}

export function getProductionTicksSince(lastProductionAt: Date): number {
  const now = Date.now();
  const elapsed = now - new Date(lastProductionAt).getTime();
  return Math.floor(elapsed / PRODUCTION_INTERVAL_MS);
}
