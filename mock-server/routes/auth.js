const express = require('express');
const router = express.Router();

/**
 * 登录（mock）：任何用户名 + 密码都通过
 *   POST /api/auth/login  body: { username, password }
 */
router.post('/login', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.fail('用户名不能为空', 400, 400);
  res.ok({
    token: 'mock-token-' + Date.now(),
    user: { username, displayName: username, role: 'tester' },
    expiresIn: 7 * 24 * 3600
  });
});

router.post('/logout', (_req, res) => res.ok({ success: true }));

module.exports = router;
