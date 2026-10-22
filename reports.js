const express = require('express');
const router = express.Router();
const path = require('path');
const { exec } = require('child_process');
const ExcelJS = require('exceljs');
const db = require('../config/db');

// FastReport DLL status endpoint
router.get('/fastreport/status', (req, res) => {
  const runnerPath = path.join(__dirname, '..', 'services', 'fastreport_runner.ps1');
  exec(`powershell -ExecutionPolicy Bypass -File "${runnerPath}" -Action version`, (error, stdout, stderr) => {
    if (error) {
      return res.json({
        available: false,
        engine: 'FastReport.NET',
        message: 'تعذر تشغيل FastReport.dll: ' + error.message
      });
    }
    const output = stdout.trim();
    res.json({
      available: true,
      engine: 'FastReport.NET v2019.4.9.0',
      status: output,
      dllPath: 'FastReport.dll'
    });
  });
});

// Official Multi-Sheet Excel Export using ExcelJS
router.get('/excel/:surveyId', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.surveyId);

    // Fetch survey & system info
    const survRes = await db.query(`
      SELECT sur.SurveyId, sur.SurveyName, sys.SystemId, sys.SystemName
      FROM tst_survey sur
      JOIN tst_systems sys ON sur.SystemId = sys.SystemId
      WHERE sur.SurveyId = @surveyId
    `, { surveyId });

    if (!survRes.recordset || survRes.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'الاستبيان غير موجود' });
    }
    const info = survRes.recordset[0];

    // Fetch questions and evaluations
    const questionsQuery = `
      SELECT q.value_id, q.q_order, q.q_name, q.q_description,
             ISNULL(q.defect_category, N'فني') AS defect_category,
             ISNULL(q.weight, 1.00) AS weight,
             ISNULL(q.max_score, 5) AS max_score,
             c.ClassName, l.LevelName,
             ISNULL(ev.rating, 3) AS user_rating,
             ISNULL(ev.score, 3.0) AS user_score,
             ev.note, ev.evidence, ev.eval_date
      FROM tst_system_q_values q
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON q.sur_level = l.LevelId
      LEFT JOIN (
        SELECT value_id, rating, score, note, evidence, eval_date,
               ROW_NUMBER() OVER (PARTITION BY value_id ORDER BY eval_date DESC) as rn
        FROM tst_user_detail_q_values
      ) ev ON q.value_id = ev.value_id AND ev.rn = 1
      WHERE q.survey_id = @surveyId
      ORDER BY q.q_order ASC, q.value_id ASC
    `;
    const qResult = await db.query(questionsQuery, { surveyId });
    const questions = qResult.recordset || [];

    // Fetch action plans if any
    const apResult = await db.query(`
      SELECT ap.*, q.q_name, c.ClassName
      FROM tst_action_plans ap
      JOIN tst_system_q_values q ON ap.value_id = q.value_id
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      WHERE ap.survey_id = @surveyId
      ORDER BY ap.plan_id ASC
    `, { surveyId });
    const actionPlans = apResult.recordset || [];

    // Calculate metrics
    let totalEarned = 0;
    let totalMax = 0;
    const defects = {
      'إداري': { count: 0, earned: 0, max: 0 },
      'فني': { count: 0, earned: 0, max: 0 },
      'برمجي': { count: 0, earned: 0, max: 0 },
      'سوء استخدام': { count: 0, earned: 0, max: 0 }
    };

    questions.forEach(q => {
      const w = parseFloat(q.weight) || 1.0;
      const r = parseInt(q.user_rating) || 3;
      const m = parseInt(q.max_score) || 5;
      totalEarned += (r * w);
      totalMax += (m * w);
      const cat = defects[q.defect_category] ? q.defect_category : 'فني';
      defects[cat].count += 1;
      defects[cat].earned += (r * w);
      defects[cat].max += (m * w);
    });

    const compliancePct = totalMax > 0 ? Math.round((totalEarned / totalMax) * 1000) / 10 : 0;
    const gapPct = Math.round((100 - compliancePct) * 10) / 10;

    // Create Excel Workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'منصة New_SmartPLS - وزارة المالية';
    wb.created = new Date();

    // -------------------------------------------------------------------------
    // SHEET 1: الملخص التنفيذي ومؤشرات الجاهزية
    // -------------------------------------------------------------------------
    const ws1 = wb.addWorksheet('الملخص التنفيذي', { views: [{ rightToLeft: true }] });
    ws1.columns = [
      { width: 30 }, { width: 35 }, { width: 20 }, { width: 25 }
    ];

    ws1.addRow(['الجمهورية اليمنية - وزارة المالية - الوحدة التنفيذية لتقنية المعلومات']);
    ws1.addRow(['تقرير التقييم والتشخيص الفني المعتمد لكفاءة وجاهزية النظام المالي الحكومي']);
    ws1.addRow([]);

    ws1.addRow(['اسم النظام المالي الخاضع للتقييم:', info.SystemName]);
    ws1.addRow(['الاستبيان الميداني المعتمد:', info.SurveyName]);
    ws1.addRow(['تاريخ استخراج التقرير:', new Date().toLocaleDateString('ar-YE')]);
    ws1.addRow(['نسبة الجاهزية والتوافق الإجمالية (SmartPLS):', `${compliancePct}%`]);
    ws1.addRow(['نسبة فجوة القصور الإجمالية:', `${gapPct}%`]);
    ws1.addRow(['إجمالي عدد الأسئلة والضوابط التقييمية:', `${questions.length} سؤال موزون`]);
    ws1.addRow([]);

    ws1.addRow(['المحور التقييمي', 'عدد الأسئلة', 'النقاط المحققة', 'نسبة الجاهزية %']);
    Object.keys(defects).forEach(k => {
      const d = defects[k];
      const pct = d.max > 0 ? Math.round((d.earned / d.max) * 1000) / 10 : 0;
      ws1.addRow([k, d.count, Math.round(d.earned * 10) / 10, `${pct}%`]);
    });

    // Style Sheet 1
    ws1.getRow(1).font = { bold: true, size: 14, color: { argb: '0A3D62' } };
    ws1.getRow(2).font = { bold: true, size: 12, color: { argb: '1E3799' } };
    const headerRow = ws1.getRow(10);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0A3D62' } };

    // -------------------------------------------------------------------------
    // SHEET 2: تفاصيل الأسئلة والتقييمات الميدانية
    // -------------------------------------------------------------------------
    const ws2 = wb.addWorksheet('تفاصيل الأسئلة والتقييم', { views: [{ rightToLeft: true }] });
    ws2.columns = [
      { header: 'م', key: 'idx', width: 8 },
      { header: 'المحور / التصنيف', key: 'class', width: 25 },
      { header: 'الفئة المستهدفة', key: 'level', width: 22 },
      { header: 'عنوان السؤال', key: 'title', width: 25 },
      { header: 'نص السؤال / الضابط التقييمي', key: 'desc', width: 45 },
      { header: 'تصنيف الخلل', key: 'defect', width: 16 },
      { header: 'الوزن', key: 'weight', width: 10 },
      { header: 'التقييم (1-5)', key: 'rating', width: 14 },
      { header: 'المبررات والشواهد الميدانية', key: 'evidence', width: 35 },
      { header: 'ملاحظات المقيم', key: 'note', width: 30 }
    ];

    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0A3D62' } };

    questions.forEach((q, i) => {
      ws2.addRow({
        idx: i + 1,
        class: q.ClassName || 'عام',
        level: q.LevelName || 'عام',
        title: q.q_name || '',
        desc: q.q_description,
        defect: q.defect_category,
        weight: q.weight,
        rating: q.user_rating,
        evidence: q.evidence || 'لا توجد شواهد مرفقة',
        note: q.note || ''
      });
    });

    // -------------------------------------------------------------------------
    // SHEET 3: مصفوفة المخاطر وخطة العمل التوصيات
    // -------------------------------------------------------------------------
    const ws3 = wb.addWorksheet('خطة العمل والتوصيات', { views: [{ rightToLeft: true }] });
    ws3.columns = [
      { header: 'رقم الإجراء', key: 'id', width: 12 },
      { header: 'المحور', key: 'class', width: 25 },
      { header: 'نوع الخلل', key: 'type', width: 16 },
      { header: 'مستوى الخطر', key: 'risk', width: 16 },
      { header: 'التوصية الفنية المعتمدة', key: 'rec', width: 45 },
      { header: 'الإجراء التصحيحي المقترح', key: 'action', width: 45 },
      { header: 'الجهة المسؤولة عن التنفيذ', key: 'party', width: 30 },
      { header: 'الجدول الزمني (يوم)', key: 'days', width: 18 },
      { header: 'الحالة', key: 'status', width: 14 }
    ];

    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '009432' } };

    if (actionPlans.length > 0) {
      actionPlans.forEach(ap => {
        ws3.addRow({
          id: `ACT-${ap.plan_id}`,
          class: ap.ClassName || 'عام',
          type: ap.defect_type,
          risk: ap.risk_level,
          rec: ap.recommendation_text,
          action: ap.corrective_action,
          party: ap.assigned_party,
          days: ap.timeline_days,
          status: ap.status
        });
      });
    } else {
      // Generate sample action plans from weak questions
      const weak = questions.filter(q => (parseInt(q.user_rating) || 3) <= 2);
      weak.forEach((q, i) => {
        ws3.addRow({
          id: `REC-${i + 1}`,
          class: q.ClassName || 'عام',
          type: q.defect_category,
          risk: q.weight >= 2 ? 'عالي جداً' : 'متوسط',
          rec: `معالجة فجوة: ${q.q_description}`,
          action: 'إجراء خطة تصحيح تقنية وتدريب المستخدمين',
          party: q.defect_category === 'إداري' ? 'الشؤون القانونية' : 'إدارة النظم والمعلومات',
          days: 30,
          status: 'مفتوح'
        });
      });
    }

    // Set response headers and send Excel
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="SmartPLS_Evaluation_${surveyId}_${Date.now()}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating Excel report:', error);
    res.status(500).json({ success: false, message: 'فشل تصدير تقرير الإكسل المتقدم' });
  }
});

module.exports = router;
