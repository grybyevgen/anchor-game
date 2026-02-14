export type PortType = 'oil' | 'materials' | 'provisions';
export type ShipType = 'tanker' | 'cargo' | 'supply' | 'barge';

export interface LevelRequirement {
  level: number;
  trips_required: number;
  coins_required: number;
}

export const LEVEL_REQUIREMENTS: LevelRequirement[] = [
  { level: 1, trips_required: 0, coins_required: 0 },
  { level: 2, trips_required: 3, coins_required: 5000 },
  { level: 3, trips_required: 10, coins_required: 15000 },
  { level: 4, trips_required: 25, coins_required: 35000 },
  { level: 5, trips_required: 50, coins_required: 75000 },
];

export const SHIP_PRICES: Record<ShipType, number> = {
  tanker: 5000,
  cargo: 4500,
  supply: 4000,
  barge: 0,
};

export const REVENUE_BONUS: Record<number, number> = {
  1: 0,
  2: 0.02,
  3: 0.05,
  4: 0.1,
  5: 0.15,
};

export const FUEL_COST_PER_TRIP: Record<ShipType, number> = {
  tanker: 20,
  cargo: 20,
  supply: 20,
  barge: 10,
};

export const HEALTH_COST_PER_TRIP: Record<ShipType, number> = {
  tanker: 10,
  cargo: 10,
  supply: 10,
  barge: 5,
};

export const MORALE_COST_PER_TRIP: Record<ShipType, number> = {
  tanker: 10,
  cargo: 10,
  supply: 10,
  barge: 5,
};

export const BARGE_CARGO_CAPACITY = 30;
export const STARTING_COINS = 0;
export const COMPANY_SETUP_BONUS = 1000;
export const REFERRAL_REWARD_COINS = 500;
export const TRAVEL_TIME_SECONDS = 8;
