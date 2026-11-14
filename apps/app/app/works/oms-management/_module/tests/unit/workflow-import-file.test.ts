import { describe, expect, it } from "vitest";
import {
  attachment,
  originalFileAccount,
  reconstructedCsv,
} from "../../server/services/workflow-import-file";

describe("original workflow files", () => {
  it("omits the bridge account only for a global account-less workflow", () => {
    expect(
      originalFileAccount({ accountIds: [], globalDiagnostics: true }, null)
    ).toEqual({});
    expect(() =>
      originalFileAccount(
        { accountIds: ["one"], globalDiagnostics: false },
        null
      )
    ).toThrow(expect.objectContaining({ code: "account_denied" }));
    expect(
      originalFileAccount(
        { accountIds: ["one"], globalDiagnostics: false },
        "one"
      )
    ).toEqual({ accountId: "one" });
    expect(() =>
      originalFileAccount(
        { accountIds: ["one"], globalDiagnostics: false },
        "two"
      )
    ).toThrow(expect.objectContaining({ code: "account_denied" }));
    expect(() =>
      originalFileAccount(
        { accountIds: [], globalDiagnostics: true },
        undefined
      )
    ).toThrow(expect.objectContaining({ code: "account_denied" }));
  });
  it("reconstructs the OMS template order, extra columns, BOM and quoted values", () => {
    const csv = reconstructedCsv("FRAUD_CHECK", [
      { extra: 'a,"b"\nc', "ORDER#": "ORDER1", object: { x: true } },
    ]);
    expect(csv.toString()).toBe(
      '\uFEFFORDER#,extra,object\nORDER1,"a,""b""\nc","{""x"":true}"\n'
    );
  });
  it("does not pretend to reconstruct a missing original PDF", () => {
    expect(() => reconstructedCsv("PDF_SPLITTER", [])).toThrow(
      expect.objectContaining({ code: "original_import_file_not_found" })
    );
  });
  it("preserves original bytes and removes header delimiters from filenames", () => {
    const content = Buffer.from([0, 255, 10]);
    const result = attachment('invoice"\r\n.csv', "text/csv", content);
    expect(result.content).toBe(content);
    expect(result.disposition).toBe('attachment; filename="invoice_.csv"');
  });
});
