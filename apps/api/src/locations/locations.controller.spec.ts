import { Test } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Reflector } from '@nestjs/core';

/**
 * The two public routes are what the registration and search forms call, and
 * both take a client-supplied `locale` that decides which of three real
 * database columns a name is read from. That makes them the place where a
 * careless implementation would let an attacker's string reach the query
 * builder as an identifier, so the fallback to English is worth asserting
 * rather than assuming.
 */
describe('LocationsController', () => {
  let controller: LocationsController;
  const reflector = new Reflector();

  const service = {
    findTree: jest.fn(),
    findCities: jest.fn(),
    findCitiesPage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    service.findTree.mockResolvedValue([]);
    service.findCities.mockResolvedValue([]);
    service.findCitiesPage.mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 });

    const moduleRef = await Test.createTestingModule({
      controllers: [LocationsController],
      providers: [{ provide: LocationsService, useValue: service }],
    }).compile();

    controller = moduleRef.get(LocationsController);
  });

  it('marks both public routes @Public(), since the sign-up forms are anonymous', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, (controller as any).tree)).toBe(true);
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, (controller as any).cities)).toBe(true);
  });

  it('gates both admin routes on a staff role', () => {
    for (const handler of ['adminTree', 'adminCities']) {
      expect(reflector.get<string[]>(ROLES_KEY, (controller as any)[handler])).toEqual([
        'ADMIN',
        'STAFF',
        'VERIFIER',
      ]);
    }
  });

  it('resolves the requested locale before it reaches the service', async () => {
    await controller.tree({ locale: 'si' });
    expect(service.findTree).toHaveBeenCalledWith('si');

    await controller.cities({ districtId: 1, locale: 'ta' });
    expect(service.findCities).toHaveBeenCalledWith(1, 'ta');
  });

  it('falls back to English for an absent or unrecognised locale', async () => {
    // The tree endpoint is reachable without a JWT. If resolveLocale were
    // dropped here, an arbitrary string would be handed to the column picker.
    await controller.tree({ locale: 'fr' });
    expect(service.findTree).toHaveBeenCalledWith('en');

    await controller.cities({ districtId: 1, locale: "en'; DROP TABLE cities;--" });
    expect(service.findCities).toHaveBeenCalledWith(1, 'en');

    await controller.cities({ districtId: 1 });
    expect(service.findCities).toHaveBeenLastCalledWith(1, 'en');
  });

  it('has no write route: reference data is loaded from CSV, never authored by hand', () => {
    const methods = Object.getOwnPropertyNames(LocationsController.prototype).filter(
      (name) => name !== 'constructor' && typeof (LocationsController.prototype as any)[name] === 'function',
    );
    expect(methods.sort()).toEqual(['adminCities', 'adminTree', 'cities', 'tree']);
  });
});