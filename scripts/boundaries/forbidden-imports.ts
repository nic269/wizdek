import type { BoundaryConfig } from "./boundary-config.ts";

export const importMatchesRule = (specifier: string, rule: string) =>
  specifier === rule || specifier.startsWith(`${rule}/`);

export const forbiddenImportRule = (input: {
  config: BoundaryConfig;
  owner: string;
  ownerRelativeFile: string;
  specifier: string;
}) => {
  const matchedRules = (
    input.config.forbiddenPackageImports[input.owner] ?? []
  ).filter((rule) => importMatchesRule(input.specifier, rule));
  const exceptions =
    input.config.forbiddenImportExceptions[input.owner]?.[
      input.ownerRelativeFile
    ] ?? [];
  return matchedRules.find((rule) => !exceptions.includes(rule));
};
