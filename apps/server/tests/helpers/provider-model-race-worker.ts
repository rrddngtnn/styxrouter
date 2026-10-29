import { getDbInstance } from "../../src/lib/db/core";
import { createInterface } from "node:readline";
import { createProviderModelsApi } from "../../server/providerModels";
import { replaceCustomModels, deleteImportedCustomModels } from "../../src/lib/db/models";

const db = getDbInstance();
const immediate = db.immediate.bind(db);
db.immediate = (fn) => { console.log("RACE_ATTEMPT"); return immediate(fn); };
const prepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const statement = prepare(sql);
  if (sql.startsWith("DELETE FROM key_value WHERE namespace = 'customModels'") || sql.startsWith("UPDATE key_value SET value = ? WHERE namespace = 'customModels'")) {
    const run = statement.run.bind(statement);
    statement.run = (...params) => { console.log("RACE_ATTEMPT"); return run(...params); };
  }
  return statement;
};
console.log("RACE_READY");
for await (const line of createInterface({ input: process.stdin })) {
  const { operation, provider, id } = JSON.parse(line);
  if (operation === "replace") {
    await replaceCustomModels(provider, [{ id: "discovered" }]);
    console.log("RACE_RESULT:" + JSON.stringify({ status: 200 }));
  } else if (operation === "cleanup") {
    await deleteImportedCustomModels(provider);
    console.log("RACE_RESULT:" + JSON.stringify({ status: 200 }));
  } else {
    const method = operation === "create" ? "POST" : operation === "edit" ? "PATCH" : "DELETE";
    const path = `/providers/${provider}/models` + (operation === "create" ? "" : `/${id}`);
    const body = operation === "create" ? { id } : { name: "Edited" };
    const response = await createProviderModelsApi().request(path, { method, headers: { "content-type": "application/json" }, ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
    console.log("RACE_RESULT:" + JSON.stringify({ status: response.status, body: await response.json() }));
  }
  break;
}
