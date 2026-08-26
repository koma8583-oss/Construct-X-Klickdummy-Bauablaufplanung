import { describe, expect, it } from 'vitest';
import {
  buildAssignablePartners,
  deduplicateDataPublications,
  getEligibleVergabePublications,
} from './vergabe';

describe('Leistung vergeben helpers', () => {
  it('shows the participant name when an assignment has no embedded AN name', () => {
    const partners = buildAssignablePartners(
      [{
        id: 'assignment-1',
        projectId: 'project-1',
        anOrgId: 'an-1',
        trade: 'Rohbau',
        assignmentStatus: 'ACTIVE',
      }],
      [],
      [{ id: 'an-1', name: 'Baupartner GmbH' }],
    );

    expect(partners).toEqual([{
      anOrgId: 'an-1',
      label: 'Baupartner GmbH – Rohbau',
    }]);
  });

  it('does not offer a published package without recipients', () => {
    const publications = [
      {
        id: 'orphan',
        dataProductType: 'TAKT_INFORMATION_PACKAGE',
        status: 'PUBLISHED',
        selectedTaktIds: [],
        recipients: [],
      },
      {
        id: 'valid',
        dataProductType: 'TAKT_INFORMATION_PACKAGE',
        status: 'PUBLISHED',
        selectedTaktIds: [],
        recipients: [{ anOrgId: 'an-1', status: 'OFFERED', anName: 'Baupartner GmbH' }],
      },
    ] as any;

    expect(getEligibleVergabePublications(publications, 'takt-1', ['an-1']).map((p) => p.id))
      .toEqual(['valid']);
  });

  it('keeps the recipient-bearing row when a publication version is duplicated', () => {
    const publications = [
      {
        id: 'orphan',
        projectId: 'project-1',
        dataProductType: 'TAKT_INFORMATION_PACKAGE',
        version: 1,
        status: 'PUBLISHED',
        createdAt: '2026-08-26T08:00:00.000Z',
        recipients: [],
      },
      {
        id: 'valid',
        projectId: 'project-1',
        dataProductType: 'TAKT_INFORMATION_PACKAGE',
        version: 1,
        status: 'PUBLISHED',
        createdAt: '2026-08-26T07:00:00.000Z',
        recipients: [{ anOrgId: 'an-1', status: 'OFFERED', anName: 'Baupartner GmbH' }],
      },
    ] as any;

    expect(deduplicateDataPublications(publications).map((p) => p.id))
      .toEqual(['valid']);
  });

  it('requires every selected AN to be a publication recipient', () => {
    const publications = [{
      id: 'partial',
      dataProductType: 'TAKT_INFORMATION_PACKAGE',
      status: 'PUBLISHED',
      selectedTaktIds: ['takt-1'],
      recipients: [{ anOrgId: 'an-1', status: 'OFFERED', anName: 'Baupartner GmbH' }],
    }] as any;

    expect(getEligibleVergabePublications(publications, 'takt-1', ['an-1', 'an-2']))
      .toEqual([]);
  });
});