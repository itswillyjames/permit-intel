export { ChicagoAdapter } from './chicago.js';
export { SeattleAdapter } from './seattle.js';
export { DenverAdapter } from './denver.js';
export type { CityAdapter, RawPermitRow } from './adapter.js';

import type { CityAdapter } from './adapter.js';
import { ChicagoAdapter } from './chicago.js';
import { SeattleAdapter } from './seattle.js';
import { DenverAdapter } from './denver.js';

export const CITY_ADAPTERS: Record<string, CityAdapter> = {
  chicago: new ChicagoAdapter(),
  seattle: new SeattleAdapter(),
  denver: new DenverAdapter(),
};

export function getAdapter(city: string): CityAdapter | null {
  return CITY_ADAPTERS[city] ?? null;
}
