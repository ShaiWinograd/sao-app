/**
 * PBI #217 PR-5 — geocode gate + coordinate persistence (integration).
 *
 * Proves against real Postgres (the GeocodeStatus enum + Float lat/lon columns)
 * that ONLY a validated RESOLVED address activates monitoring, that non-RESOLVED
 * rows keep coordinates null, and that a stray coordinate never activates.
 * Gated by TEST_DATABASE_URL; skipped in CI.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addressMonitoringCoords, toWorkerJobMonitoring, evaluateGeofence } from '@workforce/shared';
import { computeAddressGeocode } from './lib/geocoding/service.js';
import type { GeocodeProvider, GeocodeProviderResponse } from './lib/geocoding/types.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

const fakeProvider = (response: GeocodeProviderResponse): GeocodeProvider => ({ name: 'fake', geocode: async () => response });
const RESOLVED_RESP: GeocodeProviderResponse = {
  ok: true,
  candidates: [{ provider: 'azure-maps', providerPlaceId: 'p1', formattedAddress: 'הרצל 10, תל אביב', latitude: 32.06, longitude: 34.77, precision: 'HOUSE', city: 'תל אביב', confidence: 0.95 }],
};
const NEEDS_REVIEW_RESP: GeocodeProviderResponse = {
  ok: true,
  candidates: [{ provider: 'azure-maps', providerPlaceId: 'p2', formattedAddress: 'תל אביב', latitude: 32.08, longitude: 34.78, precision: 'LOCALITY', city: 'תל אביב', confidence: 0.9 }],
};

async function seedCustomer() {
  return prisma.customer.create({ data: { firstName: 'C', lastName: uid('c'), phone: '03', email: `${uid('c')}@t.test` } });
}

describe.skipIf(!TEST_DB)('geocode gate + persistence (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists coordinates for RESOLVED and activates the gate on the stored row', async () => {
    const customer = await seedCustomer();
    const created = await prisma.address.create({ data: { customerId: customer.id, fullAddress: 'הרצל 10, תל אביב', label: 'OTHER' } });
    const geo = await computeAddressGeocode({ provider: fakeProvider(RESOLVED_RESP), fullAddress: created.fullAddress });
    const row = await prisma.address.update({ where: { id: created.id }, data: geo.apply! });

    expect(row.geocodeStatus).toBe('RESOLVED');
    expect(row.latitude).toBe(32.06);
    expect(row.longitude).toBe(34.77);
    expect(addressMonitoringCoords(row)).toEqual({ latitude: 32.06, longitude: 34.77 });
    expect(toWorkerJobMonitoring(row)).toEqual({ monitoringActive: true, jobCoords: { latitude: 32.06, longitude: 34.77 } });
    const g = evaluateGeofence({ address: row, workerLatitude: 32.0605, workerLongitude: 34.77, allowedRadiusMeters: 500 });
    expect(g.locationKnown).toBe(true);
  });

  it('keeps coordinates null for NEEDS_REVIEW and never activates', async () => {
    const customer = await seedCustomer();
    const created = await prisma.address.create({ data: { customerId: customer.id, fullAddress: 'תל אביב', label: 'OTHER' } });
    const geo = await computeAddressGeocode({ provider: fakeProvider(NEEDS_REVIEW_RESP), fullAddress: created.fullAddress, city: 'תל אביב' });
    const row = await prisma.address.update({ where: { id: created.id }, data: geo.apply! });

    expect(row.geocodeStatus).toBe('NEEDS_REVIEW');
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
    expect(addressMonitoringCoords(row)).toBeNull();
    expect(toWorkerJobMonitoring(row)).toEqual({ monitoringActive: false, jobCoords: null });
  });

  it('a stray coordinate on a non-RESOLVED row never activates monitoring', async () => {
    const customer = await seedCustomer();
    // Simulate a legacy/stray coordinate written without RESOLVED (should never happen
    // via the service, but the gate must still refuse it).
    const row = await prisma.address.create({
      data: { customerId: customer.id, fullAddress: 'stray', label: 'OTHER', geocodeStatus: 'NEEDS_REVIEW', latitude: 32.0, longitude: 34.8 },
    });
    expect(addressMonitoringCoords(row)).toBeNull();
    expect(evaluateGeofence({ address: row, workerLatitude: 32.0, workerLongitude: 34.8, allowedRadiusMeters: 500 })).toEqual({
      locationKnown: false,
      distanceMeters: null,
      withinRadius: true,
    });
  });
});
