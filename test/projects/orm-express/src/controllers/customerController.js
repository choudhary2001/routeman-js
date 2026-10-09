const Customer = require('../models/Customer');

module.exports = {
  async create(req, res) {
    try {
      const customer = await Customer.create(req.body);
      res.status(201).json(customer);
    } catch (err) {
      if (err.name === 'SequelizeValidationError') {
        return res.status(400).json({ errors: err.errors.map((e) => e.message) });
      }
      throw err;
    }
  },

  async show(req, res) {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  },
};
