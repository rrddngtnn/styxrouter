import { expect, test } from "bun:test";
import { normalizeUsageQuotasForProvider } from "../src/lib/usage/providerLimits/quotaNormalize";
for (const tier of ["low", "medium", "high", "xhigh"]) test(`new quota key retained verbatim: ${tier}`, () => {
 const key = `gemini-4-hydrogen-${tier}`;
 const value = {remainingPercentage: 37, used: 630, total:1000, resetAt:"2026-11-17T08:00:43.000Z", fractionReported:true, quotaSource:"retrieveUserQuota"};
 expect(normalizeUsageQuotasForProvider("antigravity", {[key]:value})).toEqual({[key]:value});
});
test("future exact IDs remain visible while retired and non-chat IDs stay excluded", () => {
 const q={remainingPercentage:0,fractionReported:false};
 expect(normalizeUsageQuotasForProvider("antigravity", {"gemini-future-exact-ID":q,"gemini-3-flash-preview":q,"image-model":q})).toEqual({"gemini-future-exact-ID":q});
});
