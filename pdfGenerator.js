const path = require('path');
const fs = require('fs');
const { execFile, exec } = require('child_process');
const ExcelJS = require('exceljs');
const db = require('../config/db');

const ARCHIVE_DIR = path.join(__dirname, '..', 'public', 'reports_archive');

// Ensure archive directory exists
if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

// Find Microsoft Edge executable path
function getEdgePath() {
  const possiblePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft\\Edge\\Application\\msedge.exe') : null,
    process.env['PROGRAMFILES'] ? path.join(process.env['PROGRAMFILES'], 'Microsoft\\Edge\\Application\\msedge.exe') : null
  ].filter(Boolean);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'msedge';
}

/**
 * Generate Official High-Resolution PDF Report
 * Uses headless print engine rendering the pixel-perfect report.html
 */
async function generatePdfReport(surveyId = 101) {
  return new Promise(async (resolve, reject) => {
    try {
      const timestamp = Date.now();
      const fileName = `MOF_SmartPLS_Report_${surveyId}_${timestamp}.pdf`;
      const outputPath = path.join(ARCHIVE_DIR, fileName);
      const scriptPath = path.join(__dirname, 'generate_pdf.ps1');

      const cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SurveyId "${surveyId}" -OutputFile "${outputPath}"`;

      exec(cmd, { timeout: 35000 }, (err, stdout, stderr) => {
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
          resolve({
            success: true,
            filePath: outputPath,
            fileName: fileName,
            downloadUrl: `/reports_archive/${fileName}`,
            size: fs.statSync(outputPath).size
          });
        } else {
          console.error('[PDFGenerator] Error executing script:', err || stderr || stdout);
          reject(new Error('فشل محرك توليد PDF: ' + (err?.message || stdout || 'الملف لم ينشأ')));
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Generate Multi-Sheet Official Excel Report (.xlsx)
 */
async function generateExcelReport(surveyId = 101) {
  try {
    const survRes = await db.query(`
      SELECT sur.SurveyId, sur.SurveyName, sys.SystemId, sys.SystemName
      FROM tst_survey sur
      JOIN tst_systems sys ON sur.SystemId = sys.SystemId
      WHERE sur.SurveyId = @surveyId
    `, { surveyId });

    if (!survRes.recordset || survRes.recordset.length === 0) {
      throw new Error('الاستبيان المطلوب غير موجود');
    }
    const info = survRes.recordset[0];

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

    const apResult = await db.query(`
      SELECT ap.*, q.q_name, c.ClassName
      FROM tst_action_plans ap
      JOIN tst_system_q_values q ON ap.value_id = q.value_id
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      WHERE ap.survey_id = @surveyId
      ORDER BY ap.plan_id ASC
    `, { surveyId });
    const actionPlans = apResult.recordset || [];

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

    const wb = new ExcelJS.Workbook();
    wb.creator = 'منصة New_SmartPLS - وزارة المالية';
    wb.created = new Date();

    // Sheet 1: الملخص التنفيذي
    const ws1 = wb.addWorksheet('الملخص التنفيذي', { views: [{ rightToLeft: true }] });
    ws1.columns = [{ width: 32 }, { width: 38 }, { width: 22 }, { width: 26 }];
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
    ws1.getRow(1).font = { bold: true, size: 14, color: { argb: '0A3D62' } };
    ws1.getRow(2).font = { bold: true, size: 12, color: { argb: '1E3799' } };
    const hRow = ws1.getRow(10);
    hRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0A3D62' } };

    // Sheet 2: التفاصيل
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

    // Sheet 3: خطة العمل
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
    }

    const timestamp = Date.now();
    const fileName = `MOF_SmartPLS_Data_${surveyId}_${timestamp}.xlsx`;
    const outputPath = path.join(ARCHIVE_DIR, fileName);

    await wb.xlsx.writeFile(outputPath);

    return {
      success: true,
      filePath: outputPath,
      fileName: fileName,
      downloadUrl: `/reports_archive/${fileName}`,
      size: fs.statSync(outputPath).size
    };
  } catch (err) {
    console.error('[ExcelGenerator] Error generating Excel report:', err);
    throw err;
  }
}

module.exports = {
  generatePdfReport,
  generateExcelReport,
  ARCHIVE_DIR
};
