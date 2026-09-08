import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';

const JWT_SECRET = process.env.JWT_SECRET ?? 'taktkoord-jwt-dev-secret-change-in-prod';
const token = jwt.sign({
  userId: 'policy-contract-user',
  orgId: 'policy-contract-ag',
  orgType: 'AG',
  hubAdmin: false,
  roles: ['AG_ADMIN'],
}, JWT_SECRET, { expiresIn: '1h' });

describe('Leistungsfreigabe request contract', () => {
  it.each([
    ['/api/takt-requests', { taktId: 'takt-1', nuOrgId: 'an-1' }],
    ['/api/takt-requests/batch', { taktId: 'takt-1', recipients: [{ nuOrgId: 'an-1' }] }],
    ['/api/projects/project-1/takt-requests', { taktId: 'takt-1', nuOrgId: 'an-1' }],
    ['/api/leistungsanfragen', { taktId: 'takt-1', nuOrgId: 'an-1' }],
    ['/api/projects/project-1/leistungsanfragen', { taktId: 'takt-1', nuOrgId: 'an-1' }],
  ])('requires purpose, selected fields and the exact Parent-Policy on %s', async (path, body) => {
    const response = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(response.status).toBe(400);
  });

  it('rejects a manipulated purpose before evaluating project data', async () => {
    const response = await request(app)
      .post('/api/takt-requests/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        taktId: 'takt-1',
        recipients: [{
          nuOrgId: 'an-1',
          parentPolicyId: 'parent-1',
          parentPolicyVersion: 1,
        }],
        purpose: 'PROJEKTDATEN_EXPORT',
        selectedFields: ['plannedTimeWindow'],
      });

    expect(response.status).toBe(400);
  });

  it('rejects fields outside the selected purpose before Parent-Policy evaluation', async () => {
    const response = await request(app)
      .post('/api/leistungsanfragen/policy-preview')
      .set('Authorization', `Bearer ${token}`)
      .send({
        taktIds: ['takt-1'],
        nuOrgId: 'an-1',
        purpose: 'RAHMENTERMINE',
        selectedFields: ['resourceRequirements', 'projectDescription'],
        parentPolicyId: 'parent-1',
        parentPolicyVersion: 1,
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('LEISTUNGSFREIGABE_FIELDS_NOT_PERMITTED');
  });
});