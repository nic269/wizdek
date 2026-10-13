import { describe, expect, it } from "vitest";
import { findTemplateErrors, resolveTemplate, TemplateError } from "./template";

const scope = {
  json: {
    customer: { email: "a@example.com", tags: ["vip", "new"] },
    "it's": "quoted",
    "Order Name": "#1001",
    total: 1250.5,
    zero: 0,
  },
  run: { id: "run-1", storeId: "store-1" },
  trigger: { csvFile: "asset-1" },
};

describe("resolveTemplate", () => {
  it("returns the raw value when the string is exactly one placeholder", () => {
    expect(resolveTemplate("{{ $json.total }}", scope)).toBe(1250.5);
    expect(resolveTemplate("{{$json.customer.tags}}", scope)).toEqual([
      "vip",
      "new",
    ]);
    expect(resolveTemplate("  {{ $json.zero }} ", scope)).toBe(0);
  });

  it("reads quoted keys, array indexes and the other roots", () => {
    expect(resolveTemplate('{{ $json["Order Name"] }}', scope)).toBe("#1001");
    expect(resolveTemplate("{{ $json['it\\'s'] }}", scope)).toBe("quoted");
    expect(resolveTemplate("{{ $json.customer.tags[1] }}", scope)).toBe("new");
    expect(resolveTemplate("{{ $trigger.csvFile }}", scope)).toBe("asset-1");
    expect(resolveTemplate("{{ $run.storeId }}", scope)).toBe("store-1");
  });

  it("interpolates several placeholders as text", () => {
    expect(
      resolveTemplate(
        'Order {{ $json["Order Name"] }} = {{ $json.total }}',
        scope
      )
    ).toBe("Order #1001 = 1250.5");
    expect(resolveTemplate("{{ $json.a }}{{ $json.zero }}", scope)).toBe("0");
    expect(resolveTemplate("tags: {{ $json.customer.tags }}", scope)).toBe(
      'tags: ["vip","new"]'
    );
  });

  it("returns text without placeholders unchanged", () => {
    expect(resolveTemplate("high-value", scope)).toBe("high-value");
    expect(resolveTemplate("", scope)).toBe("");
  });

  it("yields undefined for a missing path instead of throwing", () => {
    expect(
      resolveTemplate("{{ $json.missing.deeper }}", scope)
    ).toBeUndefined();
    expect(resolveTemplate("{{ $json.total.digits }}", scope)).toBeUndefined();
  });

  it("cannot reach prototypes or inherited members", () => {
    for (const template of [
      "{{ $json.__proto__ }}",
      "{{ $json.constructor }}",
      '{{ $json["constructor"].prototype }}',
      "{{ $json.customer['__proto__'].polluted }}",
    ]) {
      expect(() => resolveTemplate(template, scope)).toThrow(TemplateError);
    }
    expect(resolveTemplate("{{ $json.toString }}", scope)).toBeUndefined();
    expect(resolveTemplate("{{ $json.customer.tags.length }}", scope)).toBe(2);
    expect(
      resolveTemplate("{{ $json.customer.tags.map }}", scope)
    ).toBeUndefined();
  });

  it("rejects anything that is not a plain path", () => {
    for (const template of [
      "{{ process.env.SECRET }}",
      "{{ $json.total + 1 }}",
      "{{ $json.fn() }}",
      "{{ $other.value }}",
      "{{ $json[total] }}",
      "{{ }}",
    ]) {
      expect(() => resolveTemplate(template, scope)).toThrow(TemplateError);
    }
  });
});

describe("findTemplateErrors", () => {
  it("reports each invalid placeholder and nothing for valid ones", () => {
    expect(findTemplateErrors('{{ $json.a }} {{ $json["b c"] }}')).toEqual([]);
    expect(findTemplateErrors("{{ $json.a + 1 }} and {{ nope }}")).toHaveLength(
      2
    );
  });
});
