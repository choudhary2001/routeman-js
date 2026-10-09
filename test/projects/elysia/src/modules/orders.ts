import { Elysia, NotFoundError, t } from 'elysia'
import { authPlugin, isAdmin, isAuthenticated, type AuthUser } from '../plugins/auth'
import { nextId, orders, products, type Order } from '../db'

const OrderStatus = t.Union([
  t.Literal('pending'),
  t.Literal('paid'),
  t.Literal('shipped'),
  t.Literal('delivered'),
  t.Literal('cancelled'),
])

const orderParams = t.Object({ id: t.Numeric({ minimum: 1 }) })

const findOrder = (id: number, user: AuthUser) => {
  const order = orders.find((o) => o.id === id)
  // Customers must not learn that other people's orders exist.
  if (!order || (user.role !== 'admin' && order.userId !== user.id)) {
    throw new NotFoundError('Order not found')
  }
  return order
}

export const ordersModule = new Elysia({ prefix: '/orders' })
  .use(authPlugin)
  .onBeforeHandle(isAuthenticated)
  .get(
    '/',
    ({ user, query }) => {
      const visible = user!.role === 'admin' ? orders : orders.filter((o) => o.userId === user!.id)
      return query.status ? visible.filter((o) => o.status === query.status) : visible
    },
    {
      query: t.Object({ status: t.Optional(OrderStatus) }),
      detail: { summary: 'List orders', tags: ['Orders'] },
    },
  )
  .get('/:id', ({ params: { id }, user }) => findOrder(id, user!), { params: orderParams })
  .post(
    '/',
    ({ body, user, set }) => {
      const items = []
      for (const line of body.items) {
        const product = products.find((p) => p.id === line.productId)
        if (!product) {
          set.status = 422
          return { message: `Unknown product ${line.productId}` }
        }
        if (product.stock < line.quantity) {
          set.status = 409
          return { message: `Not enough stock for ${product.name}` }
        }
        items.push({ productId: product.id, quantity: line.quantity, unitPrice: product.price })
      }

      for (const item of items) {
        products.find((p) => p.id === item.productId)!.stock -= item.quantity
      }

      const order: Order = {
        id: nextId('orders'),
        userId: user!.id,
        items,
        total: Math.round(items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0) * 100) / 100,
        status: 'pending',
        shippingAddress: body.shippingAddress,
        note: body.note,
        createdAt: new Date(),
      }
      orders.push(order)
      set.status = 201
      return order
    },
    {
      body: t.Object({
        items: t.Array(
          t.Object({
            productId: t.Number({ minimum: 1 }),
            quantity: t.Integer({ minimum: 1 }),
          }),
          { minItems: 1 },
        ),
        shippingAddress: t.String({ minLength: 5 }),
        note: t.Optional(t.String({ maxLength: 500 })),
      }),
      detail: { summary: 'Place an order', tags: ['Orders'] },
    },
  )
  .patch(
    '/:id/status',
    ({ params: { id }, body, user }) => {
      const order = findOrder(id, user!)
      order.status = body.status
      return order
    },
    {
      beforeHandle: isAdmin,
      params: orderParams,
      body: t.Object({ status: OrderStatus }),
      detail: { summary: 'Update fulfilment status', tags: ['Orders'] },
    },
  )
  .post(
    '/:id/cancel',
    ({ params: { id }, user, set }) => {
      const order = findOrder(id, user!)
      if (order.status === 'shipped' || order.status === 'delivered') {
        set.status = 409
        return { message: `Cannot cancel an order that is ${order.status}` }
      }
      order.status = 'cancelled'
      return order
    },
    { params: orderParams },
  )
