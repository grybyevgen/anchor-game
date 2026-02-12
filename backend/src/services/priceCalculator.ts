/**
 * Same formula as frontend: price per unit by port inventory.
 * Low inventory = high price (15), high inventory = low price (6).
 */
const MIN_PRICE = 6;
const MAX_PRICE = 15;
const MAX_INVENTORY = 200;

export function calculateCargoPrice(inventoryAmount: number): number {
  const inventoryRatio = Math.min(inventoryAmount / MAX_INVENTORY, 1);
  const price = MAX_PRICE - inventoryRatio * (MAX_PRICE - MIN_PRICE);
  return Math.round(price);
}
