import { Elysia, NotFoundError, t } from 'elysia'
import { authPlugin, isAdmin } from '../plugins/auth'
import { nextId, products, type Product } from '../db'

const Category = t.Union([
  t.Literal('electronics'),
  t.Literal('books'),
  t.Literal('clothing'),
  t.Literal('home'),
])

const ProductBody = t.Object({
  name: t.String({ minLength: 1 }),
  description: t.String(),
  price: t.Number({ minimum: 0.01 }),
  stock: t.Integer({ minimum: 0 }),
  category: Category,
})

const productParams = t.Object({ id: t.Numeric({ minimum: 1 }) })

const findProduct = (id: number) => {
  const product = products.find((p) => p.id === id)
  if (!product) throw new NotFoundError(`Product ${id} not found`)
  return product
}

export const productsModule = new Elysia({ prefix: '/products' })
  .use(authPlugin)
  .get(
    '/',
    ({ query }) => {
      let result = [...products]
      if (query.category) result = result.filter((p) => p.category === query.category)
      if (query.search) {
        const needle = query.search.toLowerCase()
        result = result.filter((p) => p.name.toLowerCase().includes(needle))
      }
      if (query.minPrice !== undefined) result = result.filter((p) => p.price >= query.minPrice!)
      if (query.maxPrice !== undefined) result = result.filter((p) => p.price <= query.maxPrice!)
      if (query.sort) {
        result.sort((a, b) =>
          query.sort === 'price' ? a.price - b.price : a.name.localeCompare(b.name),
        )
      }
      return result
    },
    {
      query: t.Object({
        category: t.Optional(Category),
        search: t.Optional(t.String()),
        minPrice: t.Optional(t.Numeric({ minimum: 0 })),
        maxPrice: t.Optional(t.Numeric({ minimum: 0 })),
        sort: t.Optional(t.Union([t.Literal('price'), t.Literal('name')])),
      }),
      detail: { summary: 'Browse the catalogue', tags: ['Products'] },
    },
  )
  .get('/:id', ({ params: { id } }) => findProduct(id), {
    params: productParams,
    detail: { summary: 'Product details', tags: ['Products'] },
  })
  .guard({ beforeHandle: [isAdmin] }, (app) =>
    app
      .post(
        '/',
        ({ body, set }) => {
          const product: Product = { id: nextId('products'), ...body }
          products.push(product)
          set.status = 201
          return product
        },
        { body: ProductBody, detail: { summary: 'Create product', tags: ['Products'] } },
      )
      .put(
        '/:id',
        ({ params: { id }, body }) => Object.assign(findProduct(id), body),
        { params: productParams, body: t.Partial(ProductBody) },
      )
      .delete(
        '/:id',
        ({ params: { id }, set }) => {
          const product = findProduct(id)
          products.splice(products.indexOf(product), 1)
          set.status = 204
        },
        { params: productParams },
      )
      .post(
        '/:id/image',
        ({ params: { id }, body: { image } }) => {
          const product = findProduct(id)
          product.imageUrl = `/static/products/${product.id}/${encodeURIComponent(image.name)}`
          return { imageUrl: product.imageUrl, size: image.size }
        },
        {
          params: productParams,
          body: t.Object({ image: t.File({ maxSize: '5m' }) }),
          detail: { summary: 'Upload product image', tags: ['Products'] },
        },
      ),
  )
