# 05: Deep Clean index.html

**What to build:** A massive cleanup of `public/index.html`. We will delete thousands of lines of legacy admin code (`adminPanel-*`, old `renderAdminOrders`, legacy modals) that are now safely moved to `/admin/`. This drastically reduces the file size and makes the storefront lightning fast for customers.

**Blocked by:** 04-isolate-cms-mode

**Status:** ready-for-agent

- [ ] Delete orphaned JS functions (e.g., `renderAdminOrders`, legacy queue functions)
- [ ] Delete orphaned CSS blocks related to old admin panels
- [ ] Verify customer-facing site is visually identical but significantly smaller in file size
