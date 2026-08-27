const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { getEmployeeStats } = require('../controllers/dashboard.controller');

router.get('/stats', protect, getEmployeeStats);

module.exports = router;
