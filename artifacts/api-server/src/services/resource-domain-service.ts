import { anDb as db } from "@workspace/db";
import {
  resourcesTable,
  resourceTypesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ResourceTypeRow } from "@workspace/db";

type ResourceRow = typeof resourcesTable.$inferSelect;

export class ResourceDomainError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "RESOURCE_NOT_FOUND"
      | "RESOURCE_TYPE_NOT_OWNED"
      | "RESOURCE_TYPE_MISMATCH"
      | "RESOURCE_TYPE_REQUIRED"
      | "QUANTITY_REQUIRED",
  ) {
    super(message);
    this.name = "ResourceDomainError";
  }
}

export async function loadOwnedResourceType(
  resourceTypeId: string,
  orgId: string,
): Promise<ResourceTypeRow | null> {
  const [resourceType] = await db
    .select()
    .from(resourceTypesTable)
    .where(and(
      eq(resourceTypesTable.id, resourceTypeId),
      eq(resourceTypesTable.anOrgId, orgId),
    ))
    .limit(1);
  return resourceType ?? null;
}

export async function loadOwnedResource(
  resourceId: string,
  orgId: string,
): Promise<ResourceRow | null> {
  const [resource] = await db
    .select()
    .from(resourcesTable)
    .where(and(
      eq(resourcesTable.id, resourceId),
      eq(resourcesTable.anOrgId, orgId),
    ))
    .limit(1);
  return resource ?? null;
}

export function deriveResourceFieldsFromType(resourceType: ResourceTypeRow): {
  type: "EMPLOYEE" | "CREW" | "EQUIPMENT" | "MACHINE" | "OTHER";
  capacityUnit: ResourceRow["capacityUnit"];
} {
  const categoryToType: Record<string, "EMPLOYEE" | "CREW" | "EQUIPMENT" | "MACHINE" | "OTHER"> = {
    PERSONNEL: "EMPLOYEE",
    CREW: "CREW",
    EQUIPMENT: "EQUIPMENT",
    MACHINE: "MACHINE",
    OTHER: "OTHER",
  };
  return {
    type: categoryToType[resourceType.category] ?? "OTHER",
    capacityUnit: resourceType.capacityUnit,
  };
}

export async function validateResourceTypeForOrg(
  resourceTypeId: string,
  orgId: string,
): Promise<ResourceTypeRow> {
  const resourceType = await loadOwnedResourceType(resourceTypeId, orgId);
  if (!resourceType) {
    throw new ResourceDomainError(
      "Resource type does not belong to your organisation",
      "RESOURCE_TYPE_NOT_OWNED",
    );
  }
  return resourceType;
}

export function validateResourceBooking({
  resource,
  resourceType,
  quantity,
}: {
  resource?: Pick<ResourceRow, "resourceTypeId"> | null;
  resourceType?: Pick<ResourceTypeRow, "id"> | null;
  quantity?: number | null;
}): void {
  if (!resource && !resourceType) {
    throw new ResourceDomainError(
      "At least one of 'resourceId' or 'resourceTypeId' must be provided",
      "RESOURCE_TYPE_REQUIRED",
    );
  }
  if (resource && resourceType && resource.resourceTypeId !== resourceType.id) {
    throw new ResourceDomainError("RESOURCE_TYPE_MISMATCH", "RESOURCE_TYPE_MISMATCH");
  }
  if (!resource && resourceType && (quantity == null || quantity <= 0)) {
    throw new ResourceDomainError(
      "quantity is required for type-level bookings",
      "QUANTITY_REQUIRED",
    );
  }
}