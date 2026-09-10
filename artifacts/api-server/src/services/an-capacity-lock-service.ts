import { sql } from "drizzle-orm";

/**
 * Serialize every confirmed-booking capacity decision for one AN.
 *
 * This must be called inside the transaction that performs the capacity read
 * and booking write. PostgreSQL releases the advisory lock automatically when
 * that transaction commits or rolls back.
 */
export async function lockAnConfirmedCapacity(tx: any, anOrgId: string): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${"an-confirmed-capacity:" + anOrgId}, 0)
    )
  `);
}