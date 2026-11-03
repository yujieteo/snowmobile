import type { Db } from './db.ts';
import type { GrillOut } from './types.ts';

export interface StackJob { step: string; error?: string }

export interface Cfg {
  db: Db;
  home: string;
  claude: string;
  grillModel: string;
  smAxi: string | null;
  token: string;
  frontiers: Map<string, Promise<GrillOut>>;
  grillErrors: Map<number, string>;
  stackJob: StackJob | null;
}
