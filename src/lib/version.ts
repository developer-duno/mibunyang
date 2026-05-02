export const TS_BOOTSTRAP_MILESTONE = "M0" as const;

export function getTsBootstrapVersion(): string {
  return `mibunyang TS bootstrap ${TS_BOOTSTRAP_MILESTONE}`;
}
