const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

// GET all financial systems with survey counts
router.get('/', optionalAuth, async (req, res) => {
  try {
    const groupId = req.query.groupId ? req.query.groupId.toString() : null;
    const authUser = req.user;
    const userId = authUser ? authUser.userId : (req.query.userId ? req.query.userId.toString() : null);
    const role = authUser ? authUser.role : (req.query.role || null);

    let sqlQuery = `
      SELECT s.SystemId, s.SystemName, s.system_counter,
             ISNULL((SELECT COUNT(1) FROM tst_survey sur WITH (NOLOCK) WHERE sur.SystemId = s.SystemId), 0) AS surveyCount,
             ISNULL((SELECT COUNT(1) FROM tst_system_q_values q WITH (NOLOCK) WHERE q.system_id = s.SystemId), 0) AS questionCount
      FROM tst_systems s WITH (NOLOCK)
      WHERE 1=1
    `;
    const params = {};

    // Filter by group permissions if not admin
    if (groupId && groupId !== '1' && groupId !== '5' && userId !== '100' && role !== 'admin') {
      sqlQuery += ` AND (
        s.SystemId IN (SELECT system_id FROM tst_group_detail_system WITH (NOLOCK) WHERE group_id = @groupId)
        OR NOT EXISTS (SELECT 1 FROM tst_group_detail_system WITH (NOLOCK) WHERE group_id = @groupId)
      )`;
      params.groupId = groupId;
    }

    sqlQuery += ` ORDER BY s.SystemId ASC`;
    const result = await db.query(sqlQuery, params);
    res.json({
      success: true,
      systems: result.recordset || []
    });
  } catch (error) {
    console.error('Error fetching systems:', error);
    res.status(500).json({ success: false, message: 'فشل جلب قائمة الأنظمة المالية' });
  }
});

// GET single system
router.get('/:id', async (req, res) => {
  try {
    const systemId = parseInt(req.params.id);
    const sqlQuery = `SELECT * FROM tst_systems WHERE SystemId = @systemId`;
    const result = await db.query(sqlQuery, { systemId });
    if (result.recordset && result.recordset.length > 0) {
      res.json({ success: true, system: result.recordset[0] });
    } else {
      res.status(404).json({ success: false, message: 'النظام غير موجود' });
    }
  } catch (error) {
    console.error('Error fetching system:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات النظام' });
  }
});

// POST create system
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { systemName } = req.body;
    if (!systemName || !systemName.trim()) {
      return res.status(400).json({ success: false, message: 'اسم النظام مطلوب' });
    }

    const insertQuery = `
      INSERT INTO tst_systems (SystemName, system_counter)
      OUTPUT INSERTED.SystemId, INSERTED.SystemName
      VALUES (@systemName, 0)
    `;
    const result = await db.query(insertQuery, { systemName: systemName.trim() });
    const newSystem = result.recordset && result.recordset[0] ? result.recordset[0] : { SystemName: systemName };

    res.json({
      success: true,
      message: 'تم إضافة النظام بنجاح',
      system: newSystem
    });
  } catch (error) {
    console.error('Error adding system:', error);
    res.status(500).json({ success: false, message: 'فشل إضافة النظام المالي' });
  }
});

// PUT update system
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const systemId = parseInt(req.params.id);
    const { systemName } = req.body;
    if (!systemName || !systemName.trim()) {
      return res.status(400).json({ success: false, message: 'اسم النظام مطلوب' });
    }

    const updateQuery = `
      UPDATE tst_systems
      SET SystemName = @systemName
      WHERE SystemId = @systemId
    `;
    await db.query(updateQuery, { systemId, systemName: systemName.trim() });

    res.json({
      success: true,
      message: 'تم تحديث بيانات النظام بنجاح'
    });
  } catch (error) {
    console.error('Error updating system:', error);
    res.status(500).json({ success: false, message: 'فشل تحديث النظام' });
  }
});

module.exports = router;
