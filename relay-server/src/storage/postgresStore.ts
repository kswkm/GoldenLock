import { Pool } from "pg";
import { HospitalRegistryEntry, MatchRecord } from "../types";

type State = { hospitals: HospitalRegistryEntry[]; matches: MatchRecord[] };

export class PostgresStore implements MatchingStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS matching_state (
        state_id SMALLINT PRIMARY KEY CHECK (state_id = 1),
        hospitals JSONB NOT NULL DEFAULT '[]'::jsonb,
        matches JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query("INSERT INTO matching_state (state_id) VALUES (1) ON CONFLICT DO NOTHING");
  }

  async load(): Promise<State> {
    const result = await this.pool.query<{ hospitals: HospitalRegistryEntry[]; matches: MatchRecord[] }>(
      "SELECT hospitals, matches FROM matching_state WHERE state_id = 1"
    );
    return result.rows[0] ?? { hospitals: [], matches: [] };
  }

  async save(hospitals: HospitalRegistryEntry[], matches: MatchRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [774421]);
      await client.query(
        "UPDATE matching_state SET hospitals = $1::jsonb, matches = $2::jsonb, updated_at = now() WHERE state_id = 1",
        [JSON.stringify(hospitals), JSON.stringify(matches)]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDatabasePool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_SIZE || 10), ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined });
}

export interface MatchingStore {
  initialize(): Promise<void>;
  load(): Promise<State>;
  save(hospitals: HospitalRegistryEntry[], matches: MatchRecord[]): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** DATABASE_URL 없이 로컬에서 바로 실행하기 위한 인메모리 대체 저장소 (재시작 시 상태 초기화됨). */
export class MemoryStore implements MatchingStore {
  private state: State = { hospitals: [], matches: [] };

  async initialize(): Promise<void> {}
  async load(): Promise<State> {
    return this.state;
  }
  async save(hospitals: HospitalRegistryEntry[], matches: MatchRecord[]): Promise<void> {
    this.state = { hospitals, matches };
  }
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}
