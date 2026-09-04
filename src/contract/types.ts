export interface Document {
  path: string;
  type: string;
  title: string;
  description: string;
  tier: "living" | "archive";
  status: "draft" | "stable" | "deprecated";
  staleAfter?: string;
  generated?: { by: string; at: string };
  verified: { by: string; at: string }[];
  sources: string[];
  tags: string[];
  body: string;
}

export interface ContractError {
  path: string;
  rule: string;
  message: string;
  fix: string;
}

export interface DoctorReport {
  findings: ContractError[];
  livingBytes: number;
  cap: number;
}

export function isContractError(value: Document | ContractError): value is ContractError {
  return "rule" in value;
}
