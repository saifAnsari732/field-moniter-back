const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/', authorize('admin', 'hr', 'employee'), taskController.createTask);
router.get('/all', authorize('admin'), taskController.getAllTasks);

router.get('/my', authorize('employee'), taskController.getMyTasks);
router.patch('/:id/status', authorize('employee'), taskController.updateTaskStatus);

router.delete('/:id', authorize('admin', 'hr'), taskController.deleteTask);
module.exports = router;
