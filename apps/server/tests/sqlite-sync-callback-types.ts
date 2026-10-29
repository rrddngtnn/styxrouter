import type { SqliteAdapter } from "../src/lib/db/adapters/types";
declare const db: SqliteAdapter;
const numberResult: number = db.immediate(() => 1);
const stringResult: string = db.transaction(() => "ok")();
// @ts-expect-error asynchronous transactions are forbidden
db.immediate(async () => 1);
// @ts-expect-error promise-returning transactions are forbidden
db.transaction(() => Promise.resolve(1));
// @ts-expect-error thenables are forbidden
db.immediate((): PromiseLike<number> => Promise.resolve(1));
void [numberResult, stringResult];
