import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PublicSearchController } from './public-search.controller';
import { PublicSearchService } from './public-search.service';
import { SkillsService } from '../skills/skills.service';
import { LanguagesService } from '../languages/languages.service';
import { LocationsService } from '../locations/locations.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

describe('PublicSearchController', () => {
  let controller: PublicSearchController;
  const reflector = new Reflector();

  const publicSearchService = { search: jest.fn(), findByPublicId: jest.fn() };
  const skillsService = { findAll: jest.fn().mockResolvedValue([{ id: 's1', name: 'Wound Care', category: 'Clinical' }]) };
  const languagesService = { findAll: jest.fn().mockResolvedValue([{ id: 'l1', name: 'Sinhala' }]) };
  const locationsService = {
    findAll: jest.fn().mockResolvedValue([{ id: 'loc1', district: 'Colombo', city: 'Colombo', province: 'Western' }]),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicSearchController],
      providers: [
        { provide: PublicSearchService, useValue: publicSearchService },
        { provide: SkillsService, useValue: skillsService },
        { provide: LanguagesService, useValue: languagesService },
        { provide: LocationsService, useValue: locationsService },
      ],
    }).compile();

    controller = moduleRef.get(PublicSearchController);
  });

  // Every handler on this controller MUST be @Public() - this is the whole
  // point of the module. A future route added here without the decorator
  // would silently start requiring a JWT, breaking anonymous search.
  it.each(['search', 'findOne', 'skills', 'languages', 'locations', 'searchConfig'])(
    '%s is marked @Public()',
    (handlerName) => {
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, (controller as any)[handlerName]);
      expect(isPublic).toBe(true);
    },
  );

  it('never advertises AI search as enabled (pipeline not built yet)', () => {
    expect(controller.searchConfig()).toEqual({ aiSearchEnabled: false });
  });

  it('maps meta/skills to only id, name, category - never internal fields', async () => {
    const result = await controller.skills();
    expect(result).toEqual([{ id: 's1', name: 'Wound Care', category: 'Clinical' }]);
  });

  it('delegates search to PublicSearchService', async () => {
    const dto = { page: 1, pageSize: 20 } as any;
    await controller.search(dto);
    expect(publicSearchService.search).toHaveBeenCalledWith(dto);
  });

  it('delegates profile lookup by publicId to PublicSearchService', async () => {
    await controller.findOne('pub-123');
    expect(publicSearchService.findByPublicId).toHaveBeenCalledWith('pub-123');
  });
});
