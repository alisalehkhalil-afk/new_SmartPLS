const express = require('express');
const router = express.Router();
const db = require('../config/db');
const whatsappService = require('../services/whatsappService');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

// GET all surveys (optionally by systemId or groupId)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const systemId = req.query.systemId ? parseInt(req.query.systemId) : null;
    const groupId = req.query.groupId ? req.query.groupId.toString() : null;
    const authUser = req.user;
    const userId = authUser ? authUser.userId : (req.query.userId ? req.query.userId.toString() : null);
    const role = authUser ? authUser.role : (req.query.role || null);

    let sqlQuery = `
      SELECT sur.SurveyId, sur.SystemId, sur.SurveyName, s.SystemName,
             (SELECT COUNT(1) FROM tst_survey_levels l WHERE l.SurveyId = sur.SurveyId) AS levelCount,
             (SELECT COUNT(1) FROM tst_system_q_values q WHERE q.survey_id = sur.SurveyId) AS questionCount
      FROM tst_survey sur
      JOIN tst_systems s ON sur.SystemId = s.SystemId
      WHERE 1=1
    `;
    const params = {};
    if (systemId) {
      sqlQuery += ` AND sur.SystemId = @systemId`;
      params.systemId = systemId;
    }

    if (groupId && groupId !== '1' && groupId !== '5' && userId !== '100' && role !== 'admin') {
      sqlQuery += ` AND (
        sur.SurveyId IN (SELECT survey_id FROM tst_group_detail_survey WHERE group_id = @groupId)
        OR NOT EXISTS (SELECT 1 FROM tst_group_detail_survey WHERE group_id = @groupId)
      )`;
      params.groupId = groupId;
    }

    sqlQuery += ` ORDER BY sur.SurveyId DESC`;

    const result = await db.query(sqlQuery, params);
    res.json({
      success: true,
      surveys: result.recordset
    });
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({ success: false, message: 'فشل جلب الاستبيانات' });
  }
});

// GET complete survey hierarchy tree (Survey -> Levels -> Classes -> Question Count)
router.get('/:id/tree', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id);
    const userRole = req.query.role || 'admin';
    const groupId = req.query.groupId ? req.query.groupId.toString() : null;

    // 1. Get Survey details
    const surveyRes = await db.query(`
      SELECT sur.*, s.SystemName
      FROM tst_survey sur
      JOIN tst_systems s ON sur.SystemId = s.SystemId
      WHERE sur.SurveyId = @surveyId
    `, { surveyId });

    if (!surveyRes.recordset || surveyRes.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'الاستبيان غير موجود' });
    }
    const survey = surveyRes.recordset[0];

    // 2. Get Levels
    const levelsRes = await db.query(`
      SELECT LevelId, SurveyId, LevelName
      FROM tst_survey_levels
      WHERE SurveyId = @surveyId
      ORDER BY LevelId ASC
    `, { surveyId });
    let levels = levelsRes.recordset || [];

    // Filter levels by Group Permissions if configured
    if (groupId && groupId !== '1' && groupId !== '5' && userRole !== 'admin') {
      const pLevels = await db.query(`SELECT level_id FROM tst_group_detail_levels WHERE group_id = @groupId`, { groupId });
      const allowedLevIds = (pLevels.recordset || []).map(r => r.level_id);
      if (allowedLevIds.length > 0) {
        levels = levels.filter(l => allowedLevIds.includes(l.LevelId));
      } else if (userRole === 'management') {
        levels = levels.filter(l => l.LevelName.includes('إدارة') || l.LevelName.includes('ادارة') || l.LevelId === 101 || l.LevelId === 1);
      } else if (userRole === 'tech') {
        levels = levels.filter(l => l.LevelName.includes('فني') || l.LevelName.includes('مبرمج') || l.LevelName.includes('قواعد') || l.LevelId === 102 || l.LevelId === 2);
      } else if (userRole === 'enduser') {
        levels = levels.filter(l => l.LevelName.includes('مستخدم') || l.LevelName.includes('محاسب') || l.LevelId === 103 || l.LevelId === 4);
      }
    } else {
      // Filter levels by role if not admin
      if (userRole === 'management') {
        levels = levels.filter(l => l.LevelName.includes('إدارة') || l.LevelName.includes('ادارة') || l.LevelId === 101 || l.LevelId === 1);
      } else if (userRole === 'tech') {
        levels = levels.filter(l => l.LevelName.includes('فني') || l.LevelName.includes('مبرمج') || l.LevelName.includes('قواعد') || l.LevelId === 102 || l.LevelId === 2);
      } else if (userRole === 'enduser') {
        levels = levels.filter(l => l.LevelName.includes('مستخدم') || l.LevelName.includes('محاسب') || l.LevelId === 103 || l.LevelId === 4);
      }
    }

    // 3. For each level, get classes
    const levelIds = levels.map(l => l.LevelId);
    let classes = [];
    if (levelIds.length > 0) {
      const classesRes = await db.query(`
        SELECT c.ClassId, c.LevelId, c.ClassName,
               COUNT(q.value_id) AS questionCount
        FROM tst_survey_levels_class c
        LEFT JOIN tst_system_q_values q ON c.ClassId = q.q_class_id
        WHERE c.LevelId IN (${levelIds.join(',')})
        GROUP BY c.ClassId, c.LevelId, c.ClassName
        ORDER BY c.ClassId ASC
      `);
      classes = classesRes.recordset || [];

      // Filter classes by Group Permissions if configured
      if (groupId && groupId !== '1' && groupId !== '5' && userRole !== 'admin') {
        const pClasses = await db.query(`SELECT class_id FROM tst_group_detail_classes WHERE group_id = @groupId`, { groupId });
        const allowedClsIds = (pClasses.recordset || []).map(r => r.class_id);
        if (allowedClsIds.length > 0) {
          classes = classes.filter(c => allowedClsIds.includes(c.ClassId));
        }
      }
    }

    // Build nested tree structure
    const tree = levels.map(lvl => {
      const lvlClasses = classes.filter(c => c.LevelId === lvl.LevelId);
      return {
        ...lvl,
        classes: lvlClasses
      };
    });

    res.json({
      success: true,
      survey,
      tree
    });
  } catch (error) {
    console.error('Error fetching survey tree:', error);
    res.status(500).json({ success: false, message: 'فشل جلب شجرة الاستبيان' });
  }
});

// POST create new survey (Level 2)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { systemId, surveyName } = req.body;
    if (!systemId || !surveyName) {
      return res.status(400).json({ success: false, message: 'النظام واسم الاستبيان مطلوبان' });
    }

    const insertQuery = `
      INSERT INTO tst_survey (SystemId, SurveyName)
      OUTPUT INSERTED.SurveyId, INSERTED.SystemId, INSERTED.SurveyName
      VALUES (@systemId, @surveyName)
    `;
    const result = await db.query(insertQuery, {
      systemId: parseInt(systemId),
      surveyName: surveyName.trim()
    });

    res.json({
      success: true,
      message: 'تم إنشاء الاستبيان بنجاح',
      survey: result.recordset[0]
    });
  } catch (error) {
    console.error('Error creating survey:', error);
    res.status(500).json({ success: false, message: 'فشل إنشاء الاستبيان' });
  }
});

// POST create level under survey (Level 3)
router.post('/:id/levels', requireAdmin, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id);
    const { levelName } = req.body;
    if (!levelName) {
      return res.status(400).json({ success: false, message: 'اسم المستوى/الفئة مطلوب' });
    }

    const insertQuery = `
      INSERT INTO tst_survey_levels (SurveyId, LevelName)
      OUTPUT INSERTED.LevelId, INSERTED.SurveyId, INSERTED.LevelName
      VALUES (@surveyId, @levelName)
    `;
    const result = await db.query(insertQuery, { surveyId, levelName: levelName.trim() });

    res.json({
      success: true,
      message: 'تم إضافة المستوى بنجاح',
      level: result.recordset[0]
    });
  } catch (error) {
    console.error('Error adding level:', error);
    res.status(500).json({ success: false, message: 'فشل إضافة المستوى' });
  }
});

// POST create class under level (Level 4)
router.post('/levels/:levelId/classes', requireAdmin, async (req, res) => {
  try {
    const levelId = parseInt(req.params.levelId);
    const { className } = req.body;
    if (!className) {
      return res.status(400).json({ success: false, message: 'اسم المحور/التصنيف مطلوب' });
    }

    const insertQuery = `
      INSERT INTO tst_survey_levels_class (LevelId, ClassName)
      OUTPUT INSERTED.ClassId, INSERTED.LevelId, INSERTED.ClassName
      VALUES (@levelId, @className)
    `;
    const result = await db.query(insertQuery, { levelId, className: className.trim() });

    res.json({
      success: true,
      message: 'تم إضافة المحور بنجاح',
      category: result.recordset[0]
    });
  } catch (error) {
    console.error('Error adding class:', error);
    res.status(500).json({ success: false, message: 'فشل إضافة المحور' });
  }
});

// GET levels under survey (Level 3)
router.get('/:id/levels', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.id);
    const result = await db.query(`
      SELECT LevelId, SurveyId, LevelName
      FROM tst_survey_levels
      WHERE SurveyId = @surveyId
      ORDER BY LevelId ASC
    `, { surveyId });
    res.json({ success: true, levels: result.recordset || [] });
  } catch (error) {
    console.error('Error fetching levels:', error);
    res.status(500).json({ success: false, message: 'فشل جلب المستويات' });
  }
});

// GET classes under level (Level 4)
router.get('/levels/:levelId/classes', async (req, res) => {
  try {
    const levelId = parseInt(req.params.levelId);
    const result = await db.query(`
      SELECT ClassId, LevelId, ClassName
      FROM tst_survey_levels_class
      WHERE LevelId = @levelId
      ORDER BY ClassId ASC
    `, { levelId });
    res.json({ success: true, classes: result.recordset || [] });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ success: false, message: 'فشل جلب التصنيفات' });
  }
});

// POST /api/surveys/submit-public - Public / Direct submission from Google Forms-style survey
router.post('/submit-public', async (req, res) => {
  try {
    const { surveyId, respondentName, respondentPhone, respondentRole, answers } = req.body;
    const sId = parseInt(surveyId);

    if (!sId || !answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ success: false, message: 'معرف الاستبيان وقائمة الإجابات مطلوبة' });
    }

    // Generate safe user_id (max 16 chars for tst_user_detail_q_values.user_id column)
    const cleanPhone = respondentPhone ? respondentPhone.replace(/\D/g, '') : '';
    const uid = cleanPhone ? cleanPhone.slice(-14) : 'pub_' + String(Date.now()).slice(-10);
    const sessionId = 1;
    let savedCount = 0;

    for (const ans of answers) {
      const valueId = parseInt(ans.valueId);
      if (!valueId) continue;

      const rating = parseInt(ans.rating) || 3;
      const score = parseFloat(rating);
      const evidence = ans.evidence || '';
      const note = ans.note || (respondentName ? `المقيم: ${respondentName}` : '');
      const defectCategory = ans.defectCategory || 'فني';

      // Do NOT overwrite master question bank (tst_system_q_values / tst_system_q_values_list)
      // Instead, preserve respondent choices safely within the user evaluation record
      let selectedList = [];
      if (Array.isArray(ans.selectedOptions)) {
        selectedList = ans.selectedOptions.map(s => String(s).trim()).filter(Boolean);
      } else if (ans.qValue && typeof ans.qValue === 'string') {
        selectedList = [ans.qValue.trim()];
      }

      let answerDetail = '';
      if (selectedList.length > 0) {
        answerDetail = `[خيارات محددة: ${selectedList.join(' , ')}]`;
      }
      const combinedNote = [note, answerDetail].filter(Boolean).join(' ');

      // Upsert into tst_user_detail_q_values
      const upsertSql = `
        MERGE [dbo].[tst_user_detail_q_values] WITH (HOLDLOCK) AS target
        USING (SELECT @userId AS [user_id], @valueId AS [value_id]) AS source
        ON (target.[user_id] = source.[user_id] AND target.[value_id] = source.[value_id])
        WHEN MATCHED THEN
          UPDATE SET [rating] = @rating,
                     [score] = @score,
                     [evidence] = @evidence,
                     [note] = @note,
                     [defect_category] = @defectCategory,
                     [session_id] = @sessionId,
                     [eval_date] = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT ([user_id], [value_id], [new_value_id], [rating], [score], [defect_category], [evidence], [note], [eval_date], [session_id], [evaluator_weight])
          VALUES (@userId, @valueId, @valueId, @rating, @score, @defectCategory, @evidence, @note, GETDATE(), @sessionId, 1.00);
      `;

      await db.query(upsertSql, {
        userId: uid,
        valueId,
        rating,
        score,
        evidence,
        note: combinedNote,
        defectCategory,
        sessionId
      });
      savedCount++;
    }

    // 3. Optional WhatsApp Confirmation Message to Respondent
    if (cleanPhone && cleanPhone.length >= 8) {
      try {
        const info = await db.query(`
          SELECT sur.SurveyName, s.SystemName
          FROM tst_survey sur
          JOIN tst_systems s ON sur.SystemId = s.SystemId
          WHERE sur.SurveyId = @surveyId
        `, { surveyId: sId });

        const sysName = info.recordset[0]?.SystemName || 'النظام المالي الحكومي';
        const surName = info.recordset[0]?.SurveyName || 'استبيان تقييم الكفاءة والجاهزية';

        const receiptMsg = `✅ *تم استلام تقييمكم بنجاح*\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `تحية طيبة، ${respondentName ? 'سعادة الأخ/الأخت: ' + respondentName : 'سعادة المقيم'}\n\n` +
          `نشكركم على استكمال وتعبئة استبيان تقييم:\n` +
          `🏛️ *النظام المالي:* ${sysName}\n` +
          `📋 *الاستبيان:* ${surName}\n` +
          `⭐ *عدد الأسئلة والمحاور المقيمة:* ${savedCount}\n\n` +
          `تم تسجيل وتوثيق إجاباتكم وملاحظاتكم بنجاح ومشاركتها في تحليلات الجاهزية والامتثال الحكومي (SmartPLS).\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `وزارة المالية - الوحدة التنفيذية لتقنية المعلومات`;

        whatsappService.sendMessage({
          to: cleanPhone,
          message: receiptMsg,
          eventType: 'survey_public_receipt',
          recipientName: respondentName || 'مقيم ميداني',
          sentByUser: 'public_portal'
        }).catch(waErr => console.warn('[SurveyPublicSubmit] WhatsApp receipt error:', waErr.message));
      } catch (waErr) {
        console.warn('[SurveyPublicSubmit] Failed sending WhatsApp receipt:', waErr.message);
      }
    }

    res.json({
      success: true,
      message: `تم استلام وحفظ إجابات ${savedCount} سؤال تقييمي بنجاح في المنصة`,
      savedCount,
      respondentId: uid
    });
  } catch (error) {
    console.error('Error submitting public survey:', error);
    res.status(500).json({ success: false, message: 'فشل حفظ إجابات الاستبيان: ' + error.message });
  }
});

module.exports = router;
