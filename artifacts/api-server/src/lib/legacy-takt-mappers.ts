import type {
  Takt,
  TaktRequest,
  TaktRequestSnapshot,
  TaktResponse,
  TaktResponseDecision,
  TaktVersion,
} from "@workspace/db";

export function withCanonicalTakt<T extends { taktBezeichnung: string }>(
  row: T,
): T & Pick<Takt, "leistungsBezeichnung"> {
  return { ...row, leistungsBezeichnung: row.taktBezeichnung };
}

export function withCanonicalTaktRequest<
  T extends { taktId: string; taktVersion: number },
>(row: T): T & Pick<TaktRequest, "leistungId" | "leistungVersion"> {
  return {
    ...row,
    leistungId: row.taktId,
    leistungVersion: row.taktVersion,
  };
}

export function withCanonicalSnapshot<T extends { taktRequestId: string }>(
  row: T,
): T & Pick<TaktRequestSnapshot, "leistungsanfrageId"> {
  return { ...row, leistungsanfrageId: row.taktRequestId };
}

export function withCanonicalResponse<T extends { taktRequestId: string }>(
  row: T,
): T & Pick<TaktResponse, "leistungsanfrageId"> {
  return { ...row, leistungsanfrageId: row.taktRequestId };
}

export function withCanonicalDecision<
  T extends { taktRequestId: string },
>(row: T): T & Pick<TaktResponseDecision, "leistungsanfrageId"> {
  return { ...row, leistungsanfrageId: row.taktRequestId };
}

export function withCanonicalVersion<T extends { taktId: string }>(
  row: T,
): T & Pick<TaktVersion, "leistungId"> {
  return { ...row, leistungId: row.taktId };
}