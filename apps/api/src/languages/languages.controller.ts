import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LanguagesService } from './languages.service';
import { CreateLanguageDto } from './dto/create-language.dto';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('languages')
@ApiBearerAuth()
@Controller('languages')
export class LanguagesController {
  constructor(private readonly languagesService: LanguagesService) {}

  @Get()
  findAll() {
    return this.languagesService.findAll();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateLanguageDto) {
    return this.languagesService.create(dto);
  }
}
