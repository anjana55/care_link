import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Audit({ action: 'CREATE_USER', entityType: 'User' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Audit({ action: 'UPDATE_USER', entityType: 'User' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.usersService.update(id, dto, currentUser.userId);
  }

  @Patch(':id/active')
  @Audit({ action: 'UPDATE_USER_STATUS', entityType: 'User' })
  setActive(@Param('id') id: string, @Body('isActive') isActive: boolean, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.usersService.setActive(id, isActive, currentUser.userId);
  }

  @Post(':id/reset-password')
  @Audit({ action: 'RESET_USER_PASSWORD', entityType: 'User' })
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto);
  }

  @Delete(':id')
  @Audit({ action: 'DELETE_USER', entityType: 'User' })
  remove(@Param('id') id: string, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.usersService.remove(id, currentUser.userId);
  }
}
