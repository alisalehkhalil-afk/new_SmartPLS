const express = require('express');
const router = express.Router();
const db = require('../config/db');
const whatsappService = require('../services/whatsappService');

// GET all evaluation sessions
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT s.session_id, s.survey_id, s.system_id, s.session_title, s.status,
             s.lead_evaluator_id, s.notes, s.created_date, s.submitted_date, s.approved_date, s.approved_by,
             sys.SystemName, sur.SurveyName,
             COUNT(DISTINCT ev.user_id) AS evaluator_count,
             COUNT(ev.value_id) AS evaluated_questions_count
      FROM tst_evaluation_sessions s
      JOIN tst_systems sys ON s.system_id = sys.SystemId
      JOIN tst_survey sur ON s.survey_id = sur.SurveyId
      LEFT JOIN tst_user_detail_q_values ev ON s.session_id = ev.session_id
      GROUP BY s.session_id, s.survey_id, s.system_id, s.session_title, s.status,
               s.lead_evaluator_id, s.notes, s.created_date, s.submitted_date, s.approved_date, s.approved_by,
               sys.SystemName, sur.SurveyName
      ORDER BY s.session_id DESC
    `;
    const result = await db.query(query);
    res.json({
      success: true,
      sessions: result.recordset || []
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ success: false, message: 'فشل جلب جلسات التقييم' });
  }
});

// GET single session by ID
router.get('/:id', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const sessionRes = await db.query(`
      SELECT s.*, sys.SystemName, sur.SurveyName
      FROM tst_evaluation_sessions s
      JOIN tst_systems sys ON s.system_id = sys.SystemId
      JOIN tst_survey sur ON s.survey_id = sur.SurveyId
      WHERE s.session_id = @sessionId
    `, { sessionId });

    if (!sessionRes.recordset || sessionRes.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'جلسة التقييم غير موجودة' });
    }

    const session = sessionRes.recordset[0];
    res.json({ success: true, session });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات الجلسة' });
  }
});

// POST create new evaluation session
router.post('/', async (req, res) => {
  try {
    const { surveyId, systemId, sessionTitle, leadEvaluatorId, notes } = req.body;
    if (!surveyId || !sessionTitle) {
      return res.status(400).json({ success: false, message: 'الاستبيان وعنوان الجلسة مطلوبان' });
    }

    let finalSysId = systemId;
    if (!finalSysId) {
      const survRes = await db.query('SELECT SystemId FROM tst_survey WHERE SurveyId = @surveyId', { surveyId: parseInt(surveyId) });
      if (survRes.recordset && survRes.recordset.length > 0) {
        finalSysId = survRes.recordset[0].SystemId;
      }
    }

    const insertQuery = `
      INSERT INTO tst_evaluation_sessions (
        survey_id, system_id, session_title, status, lead_evaluator_id, notes, created_date
      )
      OUTPUT INSERTED.*
      VALUES (
        @surveyId, @systemId, @sessionTitle, N'DRAFT', @leadEvaluatorId, @notes, GETDATE()
      )
    `;
    const result = await db.query(insertQuery, {
      surveyId: parseInt(surveyId),
      systemId: parseInt(finalSysId),
      sessionTitle: sessionTitle.trim(),
      leadEvaluatorId: leadEvaluatorId || '100',
      notes: notes || null
    });

    res.json({
      success: true,
      message: 'تم إنشاء جلسة التقييم بنجاح',
      session: result.recordset[0]
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ success: false, message: 'فشل إنشاء جلسة التقييم' });
  }
});

// PUT submit session for committee approval (DRAFT -> SUBMITTED)
router.put('/:id/submit', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    await db.query(`
      UPDATE tst_evaluation_sessions
      SET status = N'SUBMITTED', submitted_date = GETDATE()
      WHERE session_id = @sessionId AND status = N'DRAFT'
    `, { sessionId });

    res.json({
      success: true,
      message: 'تم إرسال جلسة التقييم بنجاح لمراجعة واعتماد رئيس اللجنة'
    });
  } catch (error) {
    console.error('Error submitting session:', error);
    res.status(500).json({ success: false, message: 'فشل إرسال الجلسة للاعتماد' });
  }
});

// PUT approve session by committee lead (SUBMITTED -> APPROVED)
router.put('/:id/approve', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const approvedBy = req.body.approvedBy || '100';

    await db.query(`
      UPDATE tst_evaluation_sessions
      SET status = N'APPROVED', approved_date = GETDATE(), approved_by = @approvedBy
      WHERE session_id = @sessionId
    `, { sessionId, approvedBy });

    // Auto-generate Action Plans for questions with rating <= 2
    const weakQuestions = await db.query(`
      SELECT DISTINCT q.value_id, q.q_name, q.q_description, q.defect_category, q.weight, ev.rating, ev.note
      FROM tst_system_q_values q
      JOIN tst_user_detail_q_values ev ON q.value_id = ev.value_id
      WHERE ev.session_id = @sessionId AND ev.rating <= 2
    `, { sessionId });

    const sessionInfo = await db.query('SELECT survey_id FROM tst_evaluation_sessions WHERE session_id = @sessionId', { sessionId });
    const surveyId = sessionInfo.recordset[0]?.survey_id || 101;

    for (const q of weakQuestions.recordset || []) {
      const exists = await db.query(`
        SELECT 1 FROM tst_action_plans WHERE session_id = @sessionId AND value_id = @valueId
      `, { sessionId, valueId: q.value_id });

      if (!exists.recordset || exists.recordset.length === 0) {
        let risk = q.weight >= 2.0 ? 'عالي جداً' : (q.weight >= 1.5 ? 'عالي' : 'متوسط');
        let rec = `معالجة فجوة (${q.defect_category}): ${q.q_description}`;
        let action = `تشكيل فريق فني لإجراء التدقيق والتصحيح خلال 30 يوماً.`;
        let party = q.defect_category === 'إداري' ? 'الإدارة العامة للشؤون القانونية والموارد' :
                    q.defect_category === 'برمجي' ? 'فريق تطوير البرمجيات والأنظمة' :
                    q.defect_category === 'سوء استخدام' ? 'إدارة التدريب والتأهيل الميداني' : 'إدارة البنية التحتية وقواعد البيانات';

        await db.query(`
          INSERT INTO tst_action_plans (
            session_id, survey_id, value_id, defect_type, risk_level,
            recommendation_text, corrective_action, assigned_party, timeline_days, status
          ) VALUES (
            @sessionId, @surveyId, @valueId, @defectType, @riskLevel,
            @rec, @action, @party, 30, N'مفتوح'
          )
        `, {
          sessionId, surveyId, valueId: q.value_id,
          defectType: q.defect_category || 'فني',
          riskLevel: risk,
          rec, action, party
        });
      }
    }

    // Trigger WhatsApp notification asynchronously if enabled
    (async () => {
      try {
        const config = await whatsappService.getConfig();
        if (config.is_enabled && config.notify_session_approved) {
          const sessDetails = await db.query(`
            SELECT s.session_id, s.session_title, s.lead_evaluator_id, sys.SystemName, sur.SurveyName, u.mobile, u.user_name_a
            FROM tst_evaluation_sessions s
            JOIN tst_systems sys ON s.system_id = sys.SystemId
            JOIN tst_survey sur ON s.survey_id = sur.SurveyId
            LEFT JOIN am_user u ON s.lead_evaluator_id = u.user_id
            WHERE s.session_id = @sessionId
          `, { sessionId });

          const row = sessDetails.recordset[0];
          const targetPhone = req.body.notifyPhone || (row?.mobile && row.mobile.trim()) || config.sender_phone || '770000000';
          if (targetPhone) {
            const msg = `🏛️ *منصة New_SmartPLS - اعتماد جلسة تقييم*\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `✅ تم اعتماد جلسة التقييم رقم #${sessionId} رسمياً.\n` +
              `📋 *العنوان:* ${row.session_title}\n` +
              `🏛️ *النظام المالي:* ${row.SystemName}\n` +
              `👤 *رئيس التقييم:* ${row.user_name_a || row.lead_evaluator_id}\n` +
              `⚠️ *خطط التحسين المنشأة:* ${weakQuestions.recordset?.length || 0} خطة لمعالجة الفجوات.\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `تم الإرسال آلياً عبر نظام إدارة التقييمات.`;

            await whatsappService.sendMessage({
              to: targetPhone,
              message: msg,
              eventType: 'session_approval',
              recipientName: row.user_name_a || 'رئيس فريق التقييم',
              sentByUser: approvedBy
            });
          }
        }
      } catch (waErr) {
        console.warn('[WhatsApp Alert] Session approval notification error:', waErr.message);
      }
    })();

    res.json({
      success: true,
      message: 'تم اعتماد جلسة التقييم رسمياً وإقفال السجلات وتوليد خطة التوصيات التصحيحية'
    });
  } catch (error) {
    console.error('Error approving session:', error);
    res.status(500).json({ success: false, message: 'فشل اعتماد جلسة التقييم' });
  }
});

// GET committee weighted consensus score for session
router.get('/:id/consensus', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const query = `
      SELECT q.value_id, q.q_name, q.q_description, q.defect_category, q.weight,
             COUNT(DISTINCT ev.user_id) AS total_evaluators,
             AVG(CAST(ev.rating AS FLOAT)) AS avg_rating,
             SUM(CAST(ev.rating AS FLOAT) * ISNULL(ev.evaluator_weight, 1.0)) / NULLIF(SUM(ISNULL(ev.evaluator_weight, 1.0)), 0) AS weighted_rating,
             MIN(ev.rating) AS min_rating,
             MAX(ev.rating) AS max_rating
      FROM tst_system_q_values q
      JOIN tst_user_detail_q_values ev ON q.value_id = ev.value_id
      WHERE ev.session_id = @sessionId
      GROUP BY q.value_id, q.q_name, q.q_description, q.defect_category, q.weight
      ORDER BY q.value_id ASC
    `;
    const result = await db.query(query, { sessionId });
    res.json({
      success: true,
      sessionId,
      consensus: result.recordset || []
    });
  } catch (error) {
    console.error('Error computing consensus:', error);
    res.status(500).json({ success: false, message: 'فشل حساب متوسطات التقييم المرجحة' });
  }
});

// GET action plans for session or survey
router.get('/:id/action-plans', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const query = `
      SELECT ap.*, q.q_name, q.q_description, c.ClassName, l.LevelName
      FROM tst_action_plans ap
      JOIN tst_system_q_values q ON ap.value_id = q.value_id
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON q.sur_level = l.LevelId
      WHERE ap.session_id = @sessionId
      ORDER BY CASE ap.risk_level WHEN N'عالي جداً' THEN 1 WHEN N'عالي' THEN 2 WHEN N'متوسط' THEN 3 ELSE 4 END ASC
    `;
    const result = await db.query(query, { sessionId });
    res.json({
      success: true,
      actionPlans: result.recordset || []
    });
  } catch (error) {
    console.error('Error fetching action plans:', error);
    res.status(500).json({ success: false, message: 'فشل جلب خطة العمل والتوصيات' });
  }
});

module.exports = router;
