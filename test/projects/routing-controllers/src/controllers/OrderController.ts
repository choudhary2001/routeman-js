import { Authorized, Body, CurrentUser, Get, JsonController, Post, QueryParams } from 'routing-controllers';
import { CreateOrderDto, OrderQuery } from '../dto/OrderDto';
import { User, userService } from '../services/UserService';

@Authorized()
@JsonController('/orders')
export class OrderController {
  @Get()
  list(@QueryParams() query: OrderQuery, @CurrentUser({ required: true }) user: User) {
    return userService.orders.filter(
      (o) => (user.role === 'admin' || o.userId === user.id) && (!query.status || o.status === query.status),
    );
  }

  @Post()
  place(@Body({ required: true }) dto: CreateOrderDto, @CurrentUser() user: User) {
    const order = { ...dto, id: userService.orders.length + 1, userId: user.id, status: 'pending' as const };
    userService.orders.push(order);
    return order;
  }
}
