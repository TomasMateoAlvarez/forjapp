import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "pg";

// Arranca la app real (Express + Postgres) contra una base de datos temporal
// (creada/destruida acá mismo) y un puerto efímero, para testear a través de
// HTTP sin mockear nada. Cada archivo de test de node:test corre en su propio
// proceso, así que fijar FORJA_TEST_DB acá (antes del import dinámico de
// app.ts) alcanza para aislar las tablas de este archivo del resto —
// equivalente al viejo FORJA_DB_PATH apuntando a un archivo SQLite temporal
// por proceso. Requiere DATABASE_URL apuntando a un Postgres real corriendo
// (ver README: Docker local para desarrollo, o el mismo servicio de Postgres
// que usa CI) con permiso para crear bases de datos.
export async function setupTestApp() {
  const testDb = `test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testDb}"`);
  await admin.end();

  process.env.FORJA_TEST_DB = testDb;
  const { app, dbReady } = await import("./app.js");
  await dbReady;
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  return {
    baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      const { pool } = await import("./db.js");
      await pool.end();

      const cleanup = new Client({ connectionString: process.env.DATABASE_URL });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS "${testDb}"`);
      await cleanup.end();
    },
  };
}

export function jsonHeaders(clientId: string): Record<string, string> {
  return { "Content-Type": "application/json", "X-Client-Id": clientId };
}

let counter = 0;
// Client-Id único por test para que sesiones/PRs/planes de un test no
// interfieran con los de otro dentro del mismo archivo (misma base de proceso).
export function uniqueClientId(): string {
  counter += 1;
  return `test-client-${process.pid}-${counter}`;
}
