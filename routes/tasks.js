const express = require('express');
const router = express.Router();
const { getTasksProgress, claimTaskReward } = require('../game-logic/tasksService');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /tasks/:userId — список заданий с прогрессом
router.get('/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const result = await getTasksProgress(userId);
    if (!result) {
        return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    res.json({ success: true, ...result });
}));

// POST /tasks/claim — забрать награду
router.post('/claim', asyncHandler(async (req, res) => {
    const { userId, taskCode } = req.body;
    if (!userId || !taskCode) {
        return res.status(400).json({ success: false, error: 'Нужны userId и taskCode' });
    }
    const result = await claimTaskReward(userId, taskCode);
    if (!result.success) {
        return res.status(400).json(result);
    }
    res.json(result);
}));

module.exports = router;
