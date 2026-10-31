import "./helpers/test-secrets";
import { expect, mock, test } from "bun:test";

const auth = mock(async () => null);
mock.module("@/lib/api/requireManagementAuth", () => ({
  requireManagementAuth: auth,
}));
const listPools = mock(() => ({ items: [], total: 0 }));
mock.module("@/lib/localDb", () => ({
  createPool: mock(),
  ensurePool: mock(),
  listPools,
}));

const { GET } = await import("../src/app/api/quota/pools/route");

test("GET quota pools rejects malformed pagination instead of silently listing every pool", async () => {
  for (const query of ["limit=oops", "limit=-1", "limit=1.5", "limit=0", "limit=201", "offset=oops", "offset=-1", "offset=1.5"]) {
    listPools.mockClear();
    const response = await GET(new Request(`http://localhost/api/quota/pools?${query}`));
    expect(response.status).toBe(400);
    expect(listPools).not.toHaveBeenCalled();
  }
});
