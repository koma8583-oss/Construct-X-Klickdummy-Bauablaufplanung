import { afterEach, describe, expect, it, vi } from "vitest";
import { hubDb, dataspaceAccessGrantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  notificationEnvelopeForConnector,
  sendNotificationOverTractusX,
  TractusXNotConfiguredError,
} from "../services/dataspace/tractusx-notification-client";

const savedEnv = { ...process.env };

afterEach(async () => {
  vi.unstubAllGlobals();
  await hubDb.delete(dataspaceAccessGrantsTable)
    .where(eq(dataspaceAccessGrantsTable.assetId, "notification-api-asset"));
  process.env = { ...savedEnv };
});

function configure() {
  Object.assign(process.env, {
    DATASPACE_CONNECTOR_CATALOG_URL: "https://connector.test/catalog",
    DATASPACE_CONNECTOR_CONTRACT_NEGOTIATION_URL: "https://connector.test/negotiations",
    DATASPACE_NOTIFICATION_DATA_PLANE_URL: "https://connector.test/transfers",
    DATASPACE_NOTIFICATION_ASSET_ID: "notification-api-asset",
    DATASPACE_NOTIFICATION_ACCESS_POLICY_ID: "notification-access",
    DATASPACE_NOTIFICATION_USAGE_POLICY_ID: "notification-usage",
    DATASPACE_CONNECTOR_COUNTER_PARTY_ADDRESS: "BPNL000000000ZZZ",
    DATASPACE_CONNECTOR_TOKEN: "connector-test-token",
    DATASPACE_PARTICIPANT_BPN_MAP: JSON.stringify({
      "ag-org": "BPNL000000000AAA",
      "an-org": "BPNL000000000ZZZ",
    }),
  });
}

describe("Tractus-X Notification API connector boundary", () => {
  it("resolves BPNs and executes catalog, negotiation, then data-plane phases", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        dataset: [{ id: "notification-api-asset" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        contractAgreementId: "agreement-1",
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        transferProcessId: "transfer-1",
        edrId: "edr-1",
      }), { status: 202 }));
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        id: "notification-delivery-1",
      }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const envelope = notificationEnvelopeForConnector({
      messageId: "f9a97301-a000-44dd-b9d8-78488a40c6bb",
      messageType: "TAKT_REQUEST_NOTIFICATION",
      sentDateTime: "2026-09-01T13:00:00.000Z",
      senderOrgId: "ag-org",
      receiverOrgId: "an-org",
      content: { correlationId: "corr-1", requestId: "request-1" },
    });
    const result = await sendNotificationOverTractusX(envelope);

    expect(result.externalReference).toBe("notification-delivery-1");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const catalogBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const negotiationBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const transferBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    const notificationBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(catalogBody.querySpec.filterExpression[0].operandRight).toBe("notification-api-asset");
    expect(negotiationBody.policy).toEqual({
      assetId: "notification-api-asset",
      accessPolicyId: "notification-access",
      usagePolicyId: "notification-usage",
    });
    expect(transferBody.assetId).toBe("notification-api-asset");
    expect(notificationBody.header.senderBpn).toBe("BPNL000000000AAA");
    expect(notificationBody.header.receiverBpn).toBe("BPNL000000000ZZZ");
    expect(notificationBody.content).toEqual({ correlationId: "corr-1", requestId: "request-1" });
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toMatchObject({
      authorization: "Bearer connector-test-token",
      "x-edc-contract-agreement-id": "agreement-1",
      "x-edc-edr-id": "edr-1",
    });

    fetchMock.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        dataset: [{ id: "notification-api-asset" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "notification-delivery-2",
      }), { status: 202 }));
    const reused = await sendNotificationOverTractusX(envelope);
    expect(reused.externalReference).toBe("notification-delivery-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-edc-contract-agreement-id": "agreement-1",
      "x-edc-edr-id": "edr-1",
    });
  });

  it("fails explicitly before transport when connector configuration is incomplete", async () => {
    delete process.env.DATASPACE_CONNECTOR_CATALOG_URL;
    await expect(sendNotificationOverTractusX({
      header: {
        messageId: "f9a97301-a000-44dd-b9d8-78488a40c6bb",
        context: "urn:construct-x:construction-service-coordination:notification:service-request:v1",
        sentDateTime: "2026-09-01T13:00:00.000Z",
        senderBpn: "BPNL000000000AAA",
        receiverBpn: "BPNL000000000ZZZ",
        version: "3.0.0",
      },
      content: {},
    })).rejects.toBeInstanceOf(TractusXNotConfiguredError);
  });
});