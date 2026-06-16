const PAGE_SIZE = 15;

/**
 * Returns Sequelize limit/offset and pagination metadata
 * @param {number} page  - current page (1-based, from req.query.page)
 * @param {number} total - total matching rows
 */
function paginate(page, total) {
  const current = Math.max(1, parseInt(page) || 1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(current, totalPages);
  return {
    limit: PAGE_SIZE,
    offset: (safePage - 1) * PAGE_SIZE,
    current: safePage,
    totalPages,
    total,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
    prev: safePage - 1,
    next: safePage + 1,
    pages: Array.from({ length: totalPages }, (_, i) => i + 1)
  };
}

module.exports = { paginate, PAGE_SIZE };
