import {
  Authorized,
  Body,
  Delete,
  Get,
  JsonController,
  NotFoundError,
  OnUndefined,
  Param,
  Post,
  Put,
  QueryParam,
} from 'routing-controllers';
import { CreateUserDto, UpdateUserDto } from '../dto/UserDto';
import { userService } from '../services/UserService';

const strip = ({ password, ...rest }: { password: string; [key: string]: unknown }) => rest;

@JsonController('/users')
export class UserController {
  @Get()
  getAll(@QueryParam('page') page: number = 1, @QueryParam('limit') limit: number = 25) {
    return userService.list(page, limit).map(strip);
  }

  @Get('/:id')
  getOne(@Param('id') id: number) {
    const user = userService.findById(id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return strip(user);
  }

  @Authorized()
  @Post()
  create(@Body() body: CreateUserDto) {
    return strip(userService.create(body));
  }

  @Authorized('admin')
  @Put('/:id')
  update(@Param('id') id: number, @Body() body: UpdateUserDto) {
    const user = userService.update(id, body);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return strip(user);
  }

  @Authorized('admin')
  @Delete('/:id')
  @OnUndefined(204)
  remove(@Param('id') id: number) {
    if (!userService.remove(id)) throw new NotFoundError(`User ${id} not found`);
  }
}
