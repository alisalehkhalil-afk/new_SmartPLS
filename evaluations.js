const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET evaluations for a specific survey
router.get('/:surveyId', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.surveyId);
    const userId = req.query.userId || '100';

    const sqlQuery = `
      SELECT ev.user_id, ev.value_id, ev.rating, ev.score, ev.defect_category,
             ev.evidence, ev.note, ev.eval_date, ev.session_id,
             q.q_order, q.q_name, q.q_description, q.weight, q.q_class_id, q.sur_level,
             q.q_type_a, q.q_value,
             c.ClassName, l.LevelName
      FROM tst_user_detail_q_values ev
      JOIN tst_system_q_values q ON ev.value_id = q.value_id
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON q.sur_level = l.LevelId
      WHERE q.survey_id = @surveyId AND ev.user_id = @userId
      ORDER BY q.q_order ASC
    `;

    const result = await db.query(sqlQuery, { surveyId, userId });
    res.json({
      success: true,
      evaluations: result.recordset
    });
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    res.status(500).json({ success: false, message: 'فشل جلب سجلات التقييم' });
  }
});

// POST submit bulk or single evaluation answers (Dual Persistence to tst_system_q_values_list and tst_user_detail_q_values)
router.post('/submit', async (req, res) => {
  try {
    const { userId, sessionId, answers } = req.body;
    // answers is array of: { valueId, rating, evidence, note, defectCategory, selectedOptions, qValue }
    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ success: false, message: 'لا توجد إجابات مرسلة للحفظ' });
    }

    const currentUserId = userId || '100';
    const currentSessionId = sessionId ? parseInt(sessionId) : 1;
    let savedCount = 0;

    for (const ans of answers) {
      const valueId = parseInt(ans.valueId);
      const rating = parseInt(ans.rating) || 3;
      const score = parseFloat(rating);
      const evidence = ans.evidence || '';
      const note = ans.note || '';
      const defectCategory = ans.defectCategory || 'فني';

      // 1. Dual Persistence: Update tst_system_q_values_list choices & tst_system_q_values q_value
      let selectedList = [];
      if (Array.isArray(ans.selectedOptions)) {
        selectedList = ans.selectedOptions.map(s => String(s).trim()).filter(Boolean);
      } else if (ans.qValue && typeof ans.qValue === 'string') {
        selectedList = [ans.qValue.trim()];
      }

      if (selectedList.length > 0) {
        // Reset choices for this question
        await db.query(`UPDATE tst_system_q_values_list SET list_value_choice = 0 WHERE value_id = @valueId`, { valueId });

        // Set list_value_choice = 1 for selected items
        for (const sel of selectedList) {
          const isNum = /^\d+$/.test(sel);
          await db.query(`
            UPDATE tst_system_q_values_list
            SET list_value_choice = 1
            WHERE value_id = @valueId AND (
              list_value = @sel 
              OR list_value LIKE @selLike 
              OR (@isNum = 1 AND list_id = @selNum)
            )
          `, {
            valueId,
            sel,
            selLike: `%${sel}%`,
            isNum: isNum ? 1 : 0,
            selNum: isNum ? parseInt(sel) : 0
          });
        }

        // Retrieve chosen texts to store into tst_system_q_values.q_value
        const chosenRes = await db.query(`
          SELECT list_value FROM tst_system_q_values_list
          WHERE value_id = @valueId AND list_value_choice = 1
          ORDER BY list_order ASC, list_id ASC
        `, { valueId });
        const chosenTexts = (chosenRes.recordset || []).map(r => r.list_value);
        const joinedVal = chosenTexts.length > 0 ? chosenTexts.join(' , ') : selectedList.join(' , ');

        await db.query(`
          UPDATE tst_system_q_values
          SET q_value = @joinedVal
          WHERE value_id = @valueId
        `, { valueId, joinedVal });
      }

      // 2. Upsert into tst_user_detail_q_values (User-specific field evaluation)
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
        userId: currentUserId,
        valueId,
        rating,
        score,
        evidence,
        note,
        defectCategory,
        sessionId: currentSessionId
      });
      savedCount++;
    }

    res.json({
      success: true,
      message: `تم حفظ وتحديث ${savedCount} سؤال تقييمي بنجاح مع مطابقة عناصر القوائم`,
      savedCount
    });
  } catch (error) {
    console.error('Error saving evaluations:', error);
    res.status(500).json({ success: false, message: 'فشل حفظ إجابات التقييم' });
  }
});

module.exports = router;
