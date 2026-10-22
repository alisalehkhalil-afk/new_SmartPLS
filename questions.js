const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

// GET questions by survey / level / class with tst_system_q_values_list options attached
router.get('/', optionalAuth, async (req, res) => {
  try {
    const surveyId = req.query.surveyId ? parseInt(req.query.surveyId) : null;
    const levelId = req.query.levelId ? parseInt(req.query.levelId) : null;
    const classId = req.query.classId ? parseInt(req.query.classId) : null;
    const classIds = req.query.classIds ? req.query.classIds.toString().split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : null;
    const groupId = req.query.groupId ? req.query.groupId.toString() : null;
    const authUser = req.user;
    const userId = authUser ? authUser.userId : (req.query.userId ? req.query.userId.toString() : null);
    const role = authUser ? authUser.role : (req.query.role || null);

    let sqlQuery = `
      SELECT q.value_id, q.q_order, q.system_id, q.survey_id, q.sur_level, q.q_class_id,
             q.q_name, q.q_type_a, q.q_description, q.is_required, q.q_control, q.q_value,
             ISNULL(q.defect_category, N'فني') AS defect_category,
             ISNULL(q.weight, 1.00) AS weight,
             ISNULL(q.max_score, 5) AS max_score,
             c.ClassName, l.LevelName, s.SystemName
      FROM tst_system_q_values q WITH (NOLOCK)
      LEFT JOIN tst_survey_levels_class c WITH (NOLOCK) ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l WITH (NOLOCK) ON q.sur_level = l.LevelId
      LEFT JOIN tst_systems s WITH (NOLOCK) ON q.system_id = s.SystemId
      WHERE 1=1
    `;
    const params = {};

    if (surveyId) {
      sqlQuery += ` AND q.survey_id = @surveyId`;
      params.surveyId = surveyId;
    }
    if (levelId) {
      sqlQuery += ` AND q.sur_level = @levelId`;
      params.levelId = levelId;
    }
    if (classId) {
      sqlQuery += ` AND q.q_class_id = @classId`;
      params.classId = classId;
    } else if (classIds && classIds.length > 0) {
      const safeIds = classIds.map(Number).filter(n => Number.isInteger(n) && n > 0);
      if (safeIds.length > 0) {
        sqlQuery += ` AND q.q_class_id IN (${safeIds.join(', ')})`;
      }
    }

    // Filter by group permissions if specified
    if (groupId && groupId !== '1' && groupId !== '5' && userId !== '100' && role !== 'admin') {
      sqlQuery += ` AND (
        q.value_id IN (SELECT value_id FROM tst_group_detail_q_values WHERE group_id = @groupId)
        OR NOT EXISTS (SELECT 1 FROM tst_group_detail_q_values WHERE group_id = @groupId)
      )`;
      params.groupId = groupId;
    } else if (role === 'management') {
      sqlQuery += ` AND (q.sur_level = 101 OR l.LevelName LIKE N'%إدار%' OR l.LevelName LIKE N'%ادار%')`;
    } else if (role === 'tech') {
      sqlQuery += ` AND (q.sur_level = 102 OR l.LevelName LIKE N'%فني%' OR l.LevelName LIKE N'%قواعد%' OR l.LevelName LIKE N'%مبرمج%')`;
    } else if (role === 'enduser') {
      sqlQuery += ` AND (q.sur_level = 103 OR l.LevelName LIKE N'%مستخدم%' OR l.LevelName LIKE N'%محاسب%')`;
    }

    sqlQuery += ` ORDER BY q.q_order ASC, q.value_id ASC`;

    const result = await db.query(sqlQuery, params);
    const rawQuestions = result.recordset || [];
    const valueIds = rawQuestions.map(q => q.value_id);

    // Fetch all options for these questions from tst_system_q_values_list
    const optionsMap = {};
    if (valueIds.length > 0) {
      // Chunk IDs into safe chunks if large
      const chunkSize = 500;
      for (let i = 0; i < valueIds.length; i += chunkSize) {
        const chunk = valueIds.slice(i, i + chunkSize);
        const listQuery = `
          SELECT list_id, value_id, list_order, list_type, list_value, list_value_choice
          FROM tst_system_q_values_list WITH (NOLOCK)
          WHERE value_id IN (${chunk.join(',')})
          ORDER BY list_order ASC, list_id ASC
        `;
        const listRes = await db.query(listQuery);
        (listRes.recordset || []).forEach(row => {
          if (!optionsMap[row.value_id]) optionsMap[row.value_id] = [];
          optionsMap[row.value_id].push(row);
        });
      }
    }

    const questions = rawQuestions.map(q => {
      let optionsData = null;
      if (q.q_value && (q.q_value.startsWith('{') || q.q_value.startsWith('['))) {
        try { optionsData = JSON.parse(q.q_value); } catch (e) { optionsData = null; }
      }

      const optionsList = optionsMap[q.value_id] || [];

      // If optionsList exists in tst_system_q_values_list, prioritize or sync optionsData
      if (optionsList.length > 0 && !optionsData) {
        optionsData = {
          options: optionsList.map(o => o.list_value),
          selected: optionsList.filter(o => o.list_value_choice === 1).map(o => o.list_value)
        };
      }

      return {
        ...q,
        optionsData,
        optionsList
      };
    });

    res.json({
      success: true,
      questions
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ success: false, message: 'فشل جلب الأسئلة' });
  }
});

// GET single question with its options from tst_system_q_values_list
router.get('/:id', async (req, res) => {
  try {
    const valueId = parseInt(req.params.id);
    const sqlQuery = `
      SELECT q.*, c.ClassName, l.LevelName, s.SystemName
      FROM tst_system_q_values q
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON q.sur_level = l.LevelId
      LEFT JOIN tst_systems s ON q.system_id = s.SystemId
      WHERE q.value_id = @valueId
    `;
    const result = await db.query(sqlQuery, { valueId });

    if (!result.recordset || result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'السؤال غير موجود' });
    }

    const question = result.recordset[0];

    // Fetch options from tst_system_q_values_list
    const optRes = await db.query(`
      SELECT list_id, value_id, list_order, list_type, list_value, list_value_choice, entry_date_time
      FROM tst_system_q_values_list
      WHERE value_id = @valueId
      ORDER BY list_order ASC, list_id ASC
    `, { valueId });

    question.optionsList = optRes.recordset || [];

    if (question.q_value && (question.q_value.startsWith('{') || question.q_value.startsWith('['))) {
      try { question.optionsData = JSON.parse(question.q_value); } catch (e) { question.optionsData = null; }
    } else if (question.optionsList.length > 0) {
      question.optionsData = {
        options: question.optionsList.map(o => o.list_value),
        selected: question.optionsList.filter(o => o.list_value_choice === 1).map(o => o.list_value)
      };
    }

    res.json({ success: true, question });
  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات السؤال' });
  }
});

// GET options for a question (tst_system_q_values_list)
router.get('/:id/options', async (req, res) => {
  try {
    const valueId = parseInt(req.params.id);
    const result = await db.query(`
      SELECT list_id, value_id, list_order, list_type, list_value, list_value_choice, entry_date_time
      FROM tst_system_q_values_list
      WHERE value_id = @valueId
      ORDER BY list_order ASC, list_id ASC
    `, { valueId });

    res.json({
      success: true,
      valueId,
      options: result.recordset || []
    });
  } catch (error) {
    console.error('Error fetching question options:', error);
    res.status(500).json({ success: false, message: 'فشل جلب عناصر القائمة' });
  }
});

// POST add an option to tst_system_q_values_list
router.post('/:id/options', requireAdmin, async (req, res) => {
  try {
    const valueId = parseInt(req.params.id);
    const listValue = req.body.listValue || req.body.list_value;
    const listType = req.body.listType || req.body.list_type;
    const listValueChoice = req.body.listValueChoice !== undefined ? req.body.listValueChoice : req.body.list_value_choice;
    const listOrder = req.body.listOrder || req.body.list_order;
    const userId = req.body.userId || req.body.user_id;

    if (!listValue || !listValue.trim()) {
      return res.status(400).json({ success: false, message: 'نص الخيار مطلوب' });
    }

    // Determine next order
    let nextOrder = listOrder ? parseInt(listOrder) : null;
    if (!nextOrder) {
      const orderRes = await db.query(`
        SELECT ISNULL(MAX(list_order), 0) + 1 AS nextOrder
        FROM tst_system_q_values_list
        WHERE value_id = @valueId
      `, { valueId });
      nextOrder = orderRes.recordset[0].nextOrder;
    }

    const finalType = listType || 'dropdowncheckbox';
    const finalChoice = listValueChoice ? 1 : 0;
    const finalUserId = userId || '100';

    const insertRes = await db.query(`
      INSERT INTO tst_system_q_values_list (
        value_id, list_order, list_type, list_value, list_value_choice, user_id, entry_user_id, entry_date_time
      )
      OUTPUT INSERTED.*
      VALUES (
        @valueId, @nextOrder, @finalType, @listValue, @finalChoice, @finalUserId, @finalUserId, GETDATE()
      )
    `, {
      valueId,
      nextOrder,
      finalType,
      listValue: listValue.trim(),
      finalChoice,
      finalUserId
    });

    res.json({
      success: true,
      message: 'تم إضافة الخيار بنجاح إلى جدول القوائم',
      option: insertRes.recordset[0]
    });
  } catch (error) {
    console.error('Error adding option:', error);
    res.status(500).json({ success: false, message: 'فشل إضافة الخيار' });
  }
});

// PUT update an option in tst_system_q_values_list
router.put('/options/:listId', requireAdmin, async (req, res) => {
  try {
    const listId = parseInt(req.params.listId);
    const listValue = req.body.listValue || req.body.list_value;
    const listValueChoice = req.body.listValueChoice !== undefined ? req.body.listValueChoice : req.body.list_value_choice;
    const listOrder = req.body.listOrder !== undefined ? req.body.listOrder : req.body.list_order;
    const listType = req.body.listType || req.body.list_type;

    await db.query(`
      UPDATE tst_system_q_values_list
      SET list_value = CASE WHEN @listValue IS NOT NULL THEN @listValue ELSE list_value END,
          list_value_choice = CASE WHEN @listValueChoice IS NOT NULL THEN @listValueChoice ELSE list_value_choice END,
          list_order = CASE WHEN @listOrder IS NOT NULL THEN @listOrder ELSE list_order END,
          list_type = CASE WHEN @listType IS NOT NULL THEN @listType ELSE list_type END
      WHERE list_id = @listId
    `, {
      listId,
      listValue: listValue ? listValue.trim() : null,
      listValueChoice: listValueChoice !== undefined ? (listValueChoice ? 1 : 0) : null,
      listOrder: listOrder !== undefined ? parseInt(listOrder) : null,
      listType: listType || null
    });

    const fetchRes = await db.query('SELECT * FROM tst_system_q_values_list WHERE list_id = @listId', { listId });

    res.json({
      success: true,
      message: 'تم تحديث الخيار بنجاح',
      option: fetchRes.recordset[0]
    });
  } catch (error) {
    console.error('Error updating option:', error);
    res.status(500).json({ success: false, message: 'فشل تحديث الخيار' });
  }
});

// DELETE an option from tst_system_q_values_list
router.delete('/options/:listId', requireAdmin, async (req, res) => {
  try {
    const listId = parseInt(req.params.listId);
    await db.query('DELETE FROM tst_system_q_values_list WHERE list_id = @listId', { listId });

    res.json({
      success: true,
      message: 'تم حذف الخيار بنجاح'
    });
  } catch (error) {
    console.error('Error deleting option:', error);
    res.status(500).json({ success: false, message: 'فشل حذف الخيار' });
  }
});

// PUT reorder options for a question
router.put('/:id/options/reorder', requireAdmin, async (req, res) => {
  try {
    const valueId = parseInt(req.params.id);
    const { orderedIds } = req.body; // array of list_id numbers

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, message: 'مصفوفة المعرفات مطلوبة' });
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const lid = parseInt(orderedIds[i]);
      await db.query(`
        UPDATE tst_system_q_values_list
        SET list_order = @order
        WHERE list_id = @lid AND value_id = @valueId
      `, { order: i + 1, lid, valueId });
    }

    res.json({
      success: true,
      message: 'تم إعادة ترتيب الخيارات بنجاح'
    });
  } catch (error) {
    console.error('Error reordering options:', error);
    res.status(500).json({ success: false, message: 'فشل إعادة الترتيب' });
  }
});

// POST create question (Google Forms & Legacy tst_system_q_values_list supported)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      systemId, surveyId, levelId, classId,
      qOrder, qName, qDescription, qType,
      defectCategory, weight, maxScore, isRequired,
      optionsData, qControl, optionsList
    } = req.body;

    if (!surveyId || !qDescription) {
      return res.status(400).json({ success: false, message: 'معرف الاستبيان ونص السؤال مطلوبان' });
    }

    const nextOrder = parseInt(qOrder) || 1;
    const finalSystemId = parseInt(systemId) || 10;
    const finalSurveyId = parseInt(surveyId);
    const finalLevelId = parseInt(levelId) || 101;
    const finalClassId = parseInt(classId) || 201;
    const finalDefect = defectCategory || 'فني';
    const finalWeight = parseFloat(weight) || 1.0;
    const finalMaxScore = parseInt(maxScore) || 5;
    const finalType = qType || 'عناصر من قائمة';
    const finalName = qName || `Q_${Date.now()}`;
    const finalReq = isRequired === false ? 0 : 1;
    const finalControl = qControl || `gforms_${finalType}`;
    const finalValue = optionsData ? (typeof optionsData === 'string' ? optionsData : JSON.stringify(optionsData)) : '';

    const insertQuery = `
      INSERT INTO tst_system_q_values (
        q_order, system_id, survey_id, sur_level, q_class_id, user_id,
        q_id, q_name, q_sql_type, q_type_a, q_description, q_control,
        is_required, Survey_date, q_value, entry_user_id, entry_date_time,
        defect_category, weight, max_score
      )
      OUTPUT INSERTED.value_id, INSERTED.q_description, INSERTED.defect_category, INSERTED.weight, INSERTED.q_type_a, INSERTED.q_value
      VALUES (
        @qOrder, @systemId, @surveyId, @levelId, @classId, 100,
        @qId, @qName, 'nvarchar', @qType, @qDescription, @qControl,
        @isRequired, GETDATE(), @qValue, '100', GETDATE(),
        @defectCategory, @weight, @maxScore
      )
    `;

    const result = await db.query(insertQuery, {
      qOrder: nextOrder,
      systemId: finalSystemId,
      surveyId: finalSurveyId,
      levelId: finalLevelId,
      classId: finalClassId,
      qId: `q_${Date.now()}`,
      qName: finalName,
      qType: finalType,
      qDescription: qDescription.trim(),
      qControl: finalControl,
      qValue: finalValue,
      isRequired: finalReq,
      defectCategory: finalDefect,
      weight: finalWeight,
      maxScore: finalMaxScore
    });

    const newQuestion = result.recordset[0];
    const newVid = newQuestion.value_id;

    // Save options to tst_system_q_values_list if provided
    let rawOpts = optionsList;
    if (!rawOpts && optionsData && Array.isArray(optionsData.options)) {
      rawOpts = optionsData.options;
    }

    if (Array.isArray(rawOpts) && rawOpts.length > 0) {
      const listType = (finalType === 'عناصر من قائمة' || finalType === 'مربعات اختيار') ? 'dropdowncheckbox' : 'dropdown';
      for (let i = 0; i < rawOpts.length; i++) {
        const optText = typeof rawOpts[i] === 'string' ? rawOpts[i] : (rawOpts[i].list_value || '');
        const isChoice = (typeof rawOpts[i] === 'object' && rawOpts[i].list_value_choice) ? 1 : 0;
        if (optText.trim()) {
          await db.query(`
            INSERT INTO tst_system_q_values_list (
              value_id, list_order, list_type, list_value, list_value_choice, user_id, entry_user_id, entry_date_time
            ) VALUES (
              @valueId, @order, @listType, @listValue, @isChoice, '100', '100', GETDATE()
            )
          `, {
            valueId: newVid,
            order: i + 1,
            listType,
            listValue: optText.trim(),
            isChoice
          });
        }
      }
    }

    res.json({
      success: true,
      message: 'تم إضافة السؤال بنجاح',
      question: newQuestion
    });
  } catch (error) {
    console.error('Error creating question:', error);
    res.status(500).json({ success: false, message: 'فشل حفظ السؤال' });
  }
});

// PUT update question
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const valueId = parseInt(req.params.id);
    const {
      qOrder, qName, qDescription, qType,
      defectCategory, weight, maxScore, isRequired, classId, levelId,
      optionsData, qControl, optionsList, replaceOptions
    } = req.body;

    const finalVal = optionsData ? (typeof optionsData === 'string' ? optionsData : JSON.stringify(optionsData)) : null;

    const updateQuery = `
      UPDATE tst_system_q_values
      SET q_order = ISNULL(@qOrder, q_order),
          q_name = ISNULL(@qName, q_name),
          q_description = ISNULL(@qDescription, q_description),
          q_type_a = ISNULL(@qType, q_type_a),
          defect_category = ISNULL(@defectCategory, defect_category),
          weight = ISNULL(@weight, weight),
          max_score = ISNULL(@maxScore, max_score),
          is_required = ISNULL(@isRequired, is_required),
          q_class_id = ISNULL(@classId, q_class_id),
          sur_level = ISNULL(@levelId, sur_level),
          q_control = ISNULL(@qControl, q_control),
          q_value = ISNULL(@qValue, q_value)
      WHERE value_id = @valueId
    `;

    await db.query(updateQuery, {
      valueId,
      qOrder: qOrder !== undefined ? parseInt(qOrder) : null,
      qName: qName || null,
      qDescription: qDescription ? qDescription.trim() : null,
      qType: qType || null,
      defectCategory: defectCategory || null,
      weight: weight !== undefined ? parseFloat(weight) : null,
      maxScore: maxScore !== undefined ? parseInt(maxScore) : null,
      isRequired: isRequired !== undefined ? (isRequired ? 1 : 0) : null,
      classId: classId ? parseInt(classId) : null,
      levelId: levelId ? parseInt(levelId) : null,
      qControl: qControl || null,
      qValue: finalVal
    });

    // Replace options if requested
    if (replaceOptions && Array.isArray(optionsList)) {
      await db.query('DELETE FROM tst_system_q_values_list WHERE value_id = @valueId', { valueId });
      const listType = (qType === 'عناصر من قائمة' || qType === 'مربعات اختيار') ? 'dropdowncheckbox' : 'dropdown';
      for (let i = 0; i < optionsList.length; i++) {
        const optText = typeof optionsList[i] === 'string' ? optionsList[i] : (optionsList[i].list_value || '');
        const isChoice = (typeof optionsList[i] === 'object' && optionsList[i].list_value_choice) ? 1 : 0;
        if (optText.trim()) {
          await db.query(`
            INSERT INTO tst_system_q_values_list (
              value_id, list_order, list_type, list_value, list_value_choice, user_id, entry_user_id, entry_date_time
            ) VALUES (
              @valueId, @order, @listType, @listValue, @isChoice, '100', '100', GETDATE()
            )
          `, {
            valueId,
            order: i + 1,
            listType,
            listValue: optText.trim(),
            isChoice
          });
        }
      }
    }

    res.json({
      success: true,
      message: 'تم تحديث السؤال بنجاح'
    });
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({ success: false, message: 'فشل تحديث بيانات السؤال' });
  }
});

// DELETE question
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const valueId = parseInt(req.params.id);
    await db.query('DELETE FROM tst_system_q_values_list WHERE value_id = @valueId', { valueId });
    await db.query('DELETE FROM tst_user_detail_q_values WHERE value_id = @valueId', { valueId });
    await db.query('DELETE FROM tst_system_q_values WHERE value_id = @valueId', { valueId });

    res.json({
      success: true,
      message: 'تم حذف السؤال وكافة عناصره بنجاح'
    });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ success: false, message: 'فشل حذف السؤال' });
  }
});

module.exports = router;
