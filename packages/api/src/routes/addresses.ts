import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateAddressSchema } from '@workforce/shared';
import { computeAddressGeocode, getConfiguredProvider } from '../lib/geocoding/service.js';

export async function addressesRoutes(app: FastifyInstance) {
  app.get('/for-customer/:customerId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { customerId } = req.params as { customerId: string };
    return prisma.address.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  });

  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateAddressSchema.parse(req.body);
    // Server-side geocoding (PBI #217). Client-supplied coordinates, if any, are
    // ignored — the status is derived only from our own lookup. Never blocks
    // create: any geocode failure yields NOT_REQUESTED/FAILED and proceeds.
    // NOTE: latitude/longitude are intentionally NOT written yet — see
    // TODO(PR-5) in lib/geocoding/service.ts.
    const geo = await computeAddressGeocode({ provider: getConfiguredProvider(), fullAddress: body.fullAddress }).catch(
      () => ({ apply: null }),
    );
    const address = await prisma.address.create({ data: { ...(body as any), ...(geo.apply ?? {}) } });
    reply.status(201);
    return address;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.address.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Address not found' });
    // Strip any client-supplied geocode fields — these are owned by the server and
    // may only be set by our own validated lookup (never trust client coordinates
    // or a client-sent geocodeStatus).
    const { latitude, longitude, geocodeStatus, geocodeReason, normalizedAddress, geocodeProvider, geocodeProviderPlaceId, geocodedAt, ...body } =
      (req.body ?? {}) as Record<string, unknown>;
    const nextFullAddress = typeof body?.fullAddress === 'string' ? (body.fullAddress as string) : existing.fullAddress;
    // Re-geocode only when the address text changed (changing it invalidates the
    // previous metadata before revalidation). Never blocks the edit.
    const geo = await computeAddressGeocode({
      provider: getConfiguredProvider(),
      fullAddress: nextFullAddress,
      previous: { fullAddress: existing.fullAddress, geocodeStatus: existing.geocodeStatus },
    }).catch(() => ({ apply: null }));
    const address = await prisma.address.update({ where: { id }, data: { ...body, ...(geo.apply ?? {}) } });
    return address;
  });

  // Owner-initiated retry/correct of geocoding for an unchanged address (§217).
  // Returns the geocode status + reason. A transient provider outage preserves
  // any previously valid geocode.
  app.post('/:id/geocode', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.address.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Address not found' });
    const geo = await computeAddressGeocode({
      provider: getConfiguredProvider(),
      fullAddress: existing.fullAddress,
      previous: { fullAddress: existing.fullAddress, geocodeStatus: existing.geocodeStatus },
      forceLookup: true,
    }).catch(() => ({ apply: null }));
    const address = geo.apply
      ? await prisma.address.update({ where: { id }, data: geo.apply })
      : existing;
    return { geocodeStatus: address.geocodeStatus, geocodeReason: address.geocodeReason, address };
  });
}
