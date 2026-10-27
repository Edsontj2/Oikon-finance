import type { ClientBase } from "pg";
export function runMigrations(client: ClientBase, log?: (msg: string) => void): Promise<void>;
