import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validate as validateOrReject } from 'class-validator';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { BrowseCitiesQueryDto, CitiesQueryDto } from './dto/cities-query.dto';
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

  /**
   * The dependent city dropdown depends on these two staying different, and
   * nothing in the type system connects a frontend hook to them.
   *
   * The staff registration wizard was silently broken for a while by exactly
   * this confusion: its hook called the ADMIN route for a dropdown's worth of
   * cities, and asked for pageSize 300 against a cap of 200. It got a 400, and
   * the query turned into an error the component rendered as an empty select -
   * no error surfaced, the district dropdown just filled and the city one never
   * did. The response shapes differ too: `cities` is a flat array a <select>
   * can consume, `adminCities` is a paginated envelope that is not iterable.
   *
   * So assert the cap that made the request invalid, and that the two routes
   * really do return different shapes.
   */
  describe('the contract the dependent city dropdown relies on', () => {
    const validate = async (cls: new () => object, input: Record<string, unknown>) => {
      const dto = Object.assign(new cls(), input);
      const errors = await validateOrReject(dto);
      return errors;
    };

    it('rejects pageSize above 200 on the browse route, so a dropdown must not ask for 300', async () => {
      const atCap = await validate(BrowseCitiesQueryDto, { pageSize: 200 });
      expect(atCap).toHaveLength(0);

      const overCap = await validate(BrowseCitiesQueryDto, { pageSize: 300 });
      expect(overCap).toHaveLength(1);
      expect(JSON.stringify(overCap[0].constraints)).toContain('max');
    });

    it('takes no pageSize at all on the public route, which returns a whole district', () => {
      // No page/pageSize on CitiesQueryDto is the point: the dropdown needs
      // every city in the district (Colombo has 164), and there is no paging
      // to unpack on the client.
      //
      // Read from the DTO source rather than from the class: TypeScript erases
      // uninitialized field declarations, so neither the instance nor the
      // prototype carries a field list, and class-transformer's plainToInstance
      // only materialises keys the request actually supplied.
      const source = readFileSync(join(__dirname, 'dto', 'cities-query.dto.ts'), 'utf8');
      const classBody = (name: string) => {
        const start = source.indexOf(`export class ${name} {`);
        expect(start).toBeGreaterThan(-1);
        const end = source.indexOf('\n}', start);
        return source.slice(start, end);
      };

      const publicCities = classBody('CitiesQueryDto');
      expect(publicCities).toContain('districtId: number;');
      expect(publicCities).not.toContain('page');
      expect(publicCities).not.toContain('pageSize');

      // ...and the browse DTO is the one that has them.
      const browse = classBody('BrowseCitiesQueryDto');
      expect(browse).toContain('page: number = 1;');
      expect(browse).toContain('pageSize: number = 50;');
    });

    it('returns a flat array from cities() and an envelope from adminCities()', async () => {
      const rows = [{ id: 1, name: 'Colombo 01', subName: null, postcode: '00100', latitude: 6.9, longitude: 79.8 }];
      service.findCities.mockResolvedValue(rows);
      const flat = await controller.cities({ districtId: 1 });
      expect(Array.isArray(flat)).toBe(true);
      expect(flat).toEqual(rows);

      service.findCitiesPage.mockResolvedValue({ items: rows, page: 1, pageSize: 50, total: 1, totalPages: 1 });
      const paged = await controller.adminCities({ districtId: 1, page: 1, pageSize: 50 });
      expect(Array.isArray(paged)).toBe(false);
      expect((paged as { items: unknown[] }).items).toEqual(rows);
    });
  });
});