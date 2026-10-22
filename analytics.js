const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Helper to prevent CSV Formula Injection
function sanitizeCsvCell(val) {
  let str = (val === null || val === undefined) ? '' : String(val).trim();
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

// Main diagnostic analysis engine endpoint
router.get('/:surveyId', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.surveyId);

    // 1. Get Survey & System Info
    const surveyInfoRes = await db.query(`
      SELECT sur.SurveyId, sur.SurveyName, s.SystemId, s.SystemName
      FROM tst_survey sur
      JOIN tst_systems s ON sur.SystemId = s.SystemId
      WHERE sur.SurveyId = @surveyId
    `, { surveyId });

    if (!surveyInfoRes.recordset || surveyInfoRes.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'الاستبيان غير موجود' });
    }
    const surveyInfo = surveyInfoRes.recordset[0];

    // 2. Fetch all questions and aggregated evaluations for this survey
    // Supports both live SQL Server and Mock Engine seamlessly
    const questionsQuery = `
      SELECT q.value_id, q.q_order, q.q_name, q.q_description,
             ISNULL(q.defect_category, N'فني') AS defect_category,
             ISNULL(q.weight, 1.00) AS weight,
             ISNULL(q.max_score, 5) AS max_score,
             q.q_class_id, q.sur_level,
             c.ClassName, l.LevelName,
             ev.avg_rating AS user_rating,
             ev.avg_score AS user_score,
             ISNULL(ev.evaluators_count, 0) AS evaluators_count,
             ev.note, ev.evidence, ev.eval_date
      FROM tst_system_q_values q
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON q.sur_level = l.LevelId
      LEFT JOIN (
        SELECT value_id,
               ROUND(AVG(CAST(rating AS FLOAT)), 2) AS avg_rating,
               ROUND(AVG(CAST(score AS FLOAT)), 2) AS avg_score,
               COUNT(user_id) AS evaluators_count,
               MAX(note) AS note,
               MAX(evidence) AS evidence,
               MAX(eval_date) AS eval_date
        FROM tst_user_detail_q_values
        GROUP BY value_id
      ) ev ON q.value_id = ev.value_id
      WHERE q.survey_id = @surveyId
      ORDER BY q.q_order ASC, q.value_id ASC
    `;

    const qResult = await db.query(questionsQuery, { surveyId });
    const questions = qResult.recordset || [];

    if (questions.length === 0) {
      return res.json({
        success: true,
        surveyInfo,
        hasData: false,
        message: 'لا توجد أسئلة مسجلة لهذا الاستبيان',
        summary: {
          totalQuestions: 0,
          evaluatedQuestionsCount: 0,
          completionPct: 0,
          evidenceCoveragePct: 0,
          overallCompliance: 0,
          totalDefectGap: 0,
          statusRating: 'لا توجد بيانات تقييمية مسجلة',
          statusBadgeClass: 'secondary',
          totalEarnedScore: 0,
          totalMaxPossible: 0,
          totalGapPoints: 0,
          evaluationDate: new Date().toISOString().split('T')[0]
        },
        defectBreakdown: [
          { key: 'إداري', name: 'الخلل الإداري واللوائح', questionCount: 0, earnedScore: 0, maxScore: 0, gapPoints: 0, categoryGapPct: 0, defectSharePct: 0, readinessPct: 0 },
          { key: 'فني', name: 'الخلل الفني والبنية التحتية', questionCount: 0, earnedScore: 0, maxScore: 0, gapPoints: 0, categoryGapPct: 0, defectSharePct: 0, readinessPct: 0 },
          { key: 'برمجي', name: 'الخلل البرمجي والوظائف', questionCount: 0, earnedScore: 0, maxScore: 0, gapPoints: 0, categoryGapPct: 0, defectSharePct: 0, readinessPct: 0 },
          { key: 'سوء استخدام', name: 'سوء الاستخدام ونقص التدريب', questionCount: 0, earnedScore: 0, maxScore: 0, gapPoints: 0, categoryGapPct: 0, defectSharePct: 0, readinessPct: 0 }
        ],
        radarData: {
          labels: [],
          datasets: [
            { label: 'مستوى الأداء والجاهزية الفعلي %', data: [] },
            { label: 'المعيار الحكومي المعتمد %', data: [] }
          ],
          axesList: []
        },
        swot: {
          strengthsCount: 0,
          weaknessesCount: 0,
          opportunitiesCount: 0,
          risksCount: 0,
          strengths: [],
          weaknesses: [],
          opportunities: [],
          risks: []
        },
        actionPlan: [],
        allQuestions: []
      });
    }

    // 3. Mathematical Engine Calculations
    let totalMaxPossible = 0;
    let totalEarnedScore = 0;
    let totalGapPoints = 0;
    let evaluatedQuestionsCount = 0;
    let evidenceCount = 0;

    // Defect dimensions
    const defects = {
      'إداري': { name: 'الخلل الإداري واللوائح', earned: 0, max: 0, gap: 0, count: 0 },
      'فني': { name: 'الخلل الفني والبنية التحتية', earned: 0, max: 0, gap: 0, count: 0 },
      'برمجي': { name: 'الخلل البرمجي والوظائف', earned: 0, max: 0, gap: 0, count: 0 },
      'سوء استخدام': { name: 'سوء الاستخدام ونقص التدريب', earned: 0, max: 0, gap: 0, count: 0 }
    };

    // Category / Class axes for Radar Chart
    const axesMap = {};

    // SWOT collections
    const strengths = [];
    const weaknesses = [];
    const opportunities = [];
    const risks = [];
    const actionPlanCandidates = [];

    questions.forEach(q => {
      const weight = parseFloat(q.weight) || 1.0;
      const maxScore = parseInt(q.max_score) || 5;
      const hasEvaluation = q.user_rating !== null && q.user_rating !== undefined;
      if (hasEvaluation) evaluatedQuestionsCount++;

      // Preserve decimals from multi-evaluator averages
      const rating = hasEvaluation ? parseFloat(q.user_rating) : 3.0;
      q.user_rating = Math.round(rating * 100) / 100;

      if (q.evidence && String(q.evidence).trim().length > 0) {
        evidenceCount++;
      }

      const maxPossible = maxScore * weight;
      const earned = rating * weight;
      const gap = Math.max(0, (maxScore - rating) * weight);

      totalMaxPossible += maxPossible;
      totalEarnedScore += earned;
      totalGapPoints += gap;

      // Defect bucket with robust category normalization
      let rawCat = (q.defect_category || 'فني').toString().trim();
      let cat = 'فني';
      if (rawCat.includes('إدار') || rawCat.includes('ادار')) cat = 'إداري';
      else if (rawCat.includes('برمج')) cat = 'برمجي';
      else if (rawCat.includes('استخدام') || rawCat.includes('تدريب')) cat = 'سوء استخدام';
      else cat = 'فني';

      q.defect_category = cat;

      defects[cat].earned += earned;
      defects[cat].max += maxPossible;
      defects[cat].gap += gap;
      defects[cat].count += 1;

      // Radar Axis bucket
      const axisName = q.ClassName || 'محور عام';
      if (!axesMap[axisName]) {
        axesMap[axisName] = { name: axisName, earned: 0, max: 0, count: 0 };
      }
      axesMap[axisName].earned += earned;
      axesMap[axisName].max += maxPossible;
      axesMap[axisName].count += 1;

      // SWOT & Action Plan Detection
      const itemScorePct = (rating / maxScore) * 100;
      const summaryItem = {
        id: q.value_id,
        order: q.q_order,
        title: q.q_name || `سؤال ${q.q_order}`,
        description: q.q_description,
        rating: q.user_rating,
        weight: weight,
        maxScore: maxScore,
        gapPoints: Math.round(gap * 100) / 100,
        category: cat,
        axis: axisName,
        percentage: Math.round(itemScorePct),
        evidence: q.evidence || '',
        note: q.note || ''
      };

      if (rating >= 4) {
        strengths.push(summaryItem);
      } else if (rating <= 2.5) {
        weaknesses.push(summaryItem);
        if (weight >= 1.5 || cat === 'برمجي' || cat === 'فني') {
          risks.push({
            ...summaryItem,
            riskSeverity: weight >= 2.0 ? 'مرتفع جداً (عاجل)' : 'متوسط إلى مرتفع'
          });
        }
      } else {
        opportunities.push(summaryItem);
      }

      if (gap > 0) {
        actionPlanCandidates.push(summaryItem);
      }
    });

    // Overall Compliance Score %
    const overallCompliance = totalMaxPossible > 0 ? (totalEarnedScore / totalMaxPossible) * 100 : 0;
    const roundedCompliance = Math.round(overallCompliance * 10) / 10;
    const totalDefectGap = Math.round((100 - roundedCompliance) * 10) / 10;
    const completionPct = Math.round((evaluatedQuestionsCount / questions.length) * 100);
    const evidenceCoveragePct = Math.round((evidenceCount / questions.length) * 100);

    let statusRating = 'جاهزية حرجة (غير مؤهل للتشغيل)';
    let statusBadgeClass = 'danger';
    if (roundedCompliance >= 85) {
      statusRating = 'جاهزية ممتازة (متوافق بدرجة عالية مع معايير وزارة المالية)';
      statusBadgeClass = 'success';
    } else if (roundedCompliance >= 70) {
      statusRating = 'جاهزية جيدة (يتطلب استكمال معالجة بعض الفجوات المحددة)';
      statusBadgeClass = 'info';
    } else if (roundedCompliance >= 55) {
      statusRating = 'جاهزية متوسطة (يتطلب خطة تصحيحية عاجلة وتدخل تقني)';
      statusBadgeClass = 'warning';
    }

    // Top Priority Action Plan (Sorted by highest weighted gap impact)
    const actionPlan = actionPlanCandidates
      .sort((a, b) => b.gapPoints - a.gapPoints)
      .slice(0, 6)
      .map(item => ({
        ...item,
        impactOnOverallPct: totalMaxPossible > 0
          ? Math.round(((item.gapPoints / totalMaxPossible) * 100) * 10) / 10
          : 0
      }));

    // Process Defects Breakdown
    const defectBreakdown = Object.keys(defects).map(key => {
      const d = defects[key];
      const categoryGapPct = d.max > 0 ? Math.round(((d.gap / d.max) * 100) * 10) / 10 : 0;
      const defectSharePct = totalGapPoints > 0 ? Math.round(((d.gap / totalGapPoints) * 100) * 10) / 10 : 0;
      const readinessPct = d.max > 0 ? Math.round(((d.earned / d.max) * 100) * 10) / 10 : 0;
      return {
        key,
        name: d.name,
        questionCount: d.count,
        earnedScore: Math.round(d.earned * 10) / 10,
        maxScore: Math.round(d.max * 10) / 10,
        gapPoints: Math.round(d.gap * 10) / 10,
        categoryGapPct,
        defectSharePct,
        readinessPct
      };
    });

    // Process Radar Chart Data (Axes)
    const radarLabels = [];
    const radarEarnedPct = [];
    const radarBenchmark = [];
    const axesList = [];

    Object.keys(axesMap).forEach(key => {
      const a = axesMap[key];
      const pct = a.max > 0 ? Math.round((a.earned / a.max) * 100) : 0;
      radarLabels.push(key);
      radarEarnedPct.push(pct);
      radarBenchmark.push(95);
      axesList.push({
        axisName: key,
        questionCount: a.count,
        scorePct: pct
      });
    });

    res.json({
      success: true,
      hasData: true,
      surveyInfo,
      summary: {
        totalQuestions: questions.length,
        evaluatedQuestionsCount,
        completionPct,
        evidenceCoveragePct,
        overallCompliance: roundedCompliance,
        totalDefectGap,
        statusRating,
        statusBadgeClass,
        totalEarnedScore: Math.round(totalEarnedScore * 10) / 10,
        totalMaxPossible: Math.round(totalMaxPossible * 10) / 10,
        totalGapPoints: Math.round(totalGapPoints * 10) / 10,
        evaluationDate: new Date().toISOString().split('T')[0]
      },
      defectBreakdown,
      radarData: {
        labels: radarLabels,
        datasets: [
          {
            label: 'مستوى الأداء والجاهزية الفعلي %',
            data: radarEarnedPct
          },
          {
            label: 'المعيار الحكومي المعتمد %',
            data: radarBenchmark
          }
        ],
        axesList
      },
      swot: {
        strengthsCount: strengths.length,
        weaknessesCount: weaknesses.length,
        opportunitiesCount: opportunities.length,
        risksCount: risks.length,
        strengths,
        weaknesses,
        opportunities,
        risks
      },
      actionPlan,
      allQuestions: questions
    });
  } catch (error) {
    console.error('Error generating diagnostic analytics:', error);
    res.status(500).json({ success: false, message: 'فشل احتساب مؤشرات التحليل والتشخيص' });
  }
});

// Excel / CSV Export for official reports (Aggregated per question & protected from CSV Injection)
router.get('/export-excel/:surveyId', async (req, res) => {
  try {
    const surveyId = parseInt(req.params.surveyId);

    const qResult = await db.query(`
      SELECT q.value_id, q.q_order, q.q_name, q.q_description,
             ISNULL(q.defect_category, N'فني') AS defect_category,
             ISNULL(q.weight, 1.00) AS weight,
             c.ClassName, l.LevelName,
             ISNULL(ev.avg_rating, 3) AS rating,
             ev.evidence, ev.note
      FROM tst_system_q_values q
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON q.sur_level = l.LevelId
      LEFT JOIN (
        SELECT value_id,
               ROUND(AVG(CAST(rating AS FLOAT)), 2) AS avg_rating,
               MAX(evidence) AS evidence,
               MAX(note) AS note
        FROM tst_user_detail_q_values
        GROUP BY value_id
      ) ev ON q.value_id = ev.value_id
      WHERE q.survey_id = @surveyId
      ORDER BY q.q_order ASC
    `, { surveyId });

    const rows = qResult.recordset || [];

    let csv = '\uFEFF';
    csv += 'رقم السؤال,المحور / التصنيف,الفئة المستهدفة,السؤال,تصنيف الخلل,الوزن النسبي,درجة التقييم (1-5),نسبة الإنجاز %,شواهد الإثبات,ملاحظات المدقق\n';

    rows.forEach(r => {
      const pct = Math.round((r.rating / 5) * 100);
      csv += [
        r.q_order,
        sanitizeCsvCell(r.ClassName),
        sanitizeCsvCell(r.LevelName),
        sanitizeCsvCell(r.q_description),
        sanitizeCsvCell(r.defect_category),
        r.weight,
        r.rating,
        `${pct}%`,
        sanitizeCsvCell(r.evidence),
        sanitizeCsvCell(r.note)
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="MoF_Evaluation_Survey_${surveyId}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'فشل تصدير التقرير' });
  }
});

// GET Multi-System Benchmarking Comparison (مقارنة رادارية معيارية بين نظامين)
router.get('/compare/systems', async (req, res) => {
  try {
    const surveyId1 = parseInt(req.query.survey1 || 101);
    const surveyId2 = parseInt(req.query.survey2 || 102);

    async function getSurveyMetrics(sId) {
      const infoRes = await db.query(`
        SELECT sur.SurveyId, sur.SurveyName, s.SystemId, s.SystemName
        FROM tst_survey sur
        JOIN tst_systems s ON sur.SystemId = s.SystemId
        WHERE sur.SurveyId = @sId
      `, { sId });
      const info = infoRes.recordset[0] || { SurveyName: `استبيان ${sId}`, SystemName: `نظام ${sId}` };

      const qRes = await db.query(`
        SELECT q.value_id, q.q_name, ISNULL(q.defect_category, N'فني') AS defect_category,
               ISNULL(q.weight, 1.0) AS weight, ISNULL(q.max_score, 5) AS max_score,
               c.ClassName, ISNULL(ev.avg_rating, 3) AS rating
        FROM tst_system_q_values q
        LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
        LEFT JOIN (
          SELECT value_id, ROUND(AVG(CAST(rating AS FLOAT)), 2) AS avg_rating
          FROM tst_user_detail_q_values
          GROUP BY value_id
        ) ev ON q.value_id = ev.value_id
        WHERE q.survey_id = @sId
      `, { sId });

      const questions = qRes.recordset || [];
      let earned = 0, max = 0;
      const axes = {};
      const defects = { 'إداري': 0, 'فني': 0, 'برمجي': 0, 'سوء استخدام': 0 };
      const defectCounts = { 'إداري': 0, 'فني': 0, 'برمجي': 0, 'سوء استخدام': 0 };

      questions.forEach(q => {
        const w = parseFloat(q.weight) || 1.0;
        const r = parseFloat(q.rating) || 3.0;
        const m = parseInt(q.max_score) || 5;
        earned += (r * w);
        max += (m * w);

        const axis = q.ClassName || 'عام';
        if (!axes[axis]) axes[axis] = { earned: 0, max: 0 };
        axes[axis].earned += (r * w);
        axes[axis].max += (m * w);

        const cat = defects[q.defect_category] !== undefined ? q.defect_category : 'فني';
        defects[cat] += (r * w);
        defectCounts[cat] += (m * w);
      });

      const compliance = max > 0 ? Math.round((earned / max) * 1000) / 10 : 0;
      return { info, questionsCount: questions.length, compliance, axes, defects, defectCounts };
    }

    const data1 = await getSurveyMetrics(surveyId1);
    const data2 = await getSurveyMetrics(surveyId2);

    const allAxes = Array.from(new Set([...Object.keys(data1.axes), ...Object.keys(data2.axes)]));
    const radarLabels = allAxes.length > 0 ? allAxes : ['الحوكمة واللوائح', 'التقارير ودعم القرار', 'قواعد البيانات', 'البنية والأمان', 'الربط والتكامل', 'سهولة الواجهات', 'دقة القيود', 'التدريب والدعم'];

    const dataset1 = radarLabels.map(axis => {
      const a = data1.axes[axis];
      return a && a.max > 0 ? Math.round((a.earned / a.max) * 100) : 75;
    });

    const dataset2 = radarLabels.map(axis => {
      const a = data2.axes[axis];
      return a && a.max > 0 ? Math.round((a.earned / a.max) * 100) : 65;
    });

    res.json({
      success: true,
      system1: {
        name: data1.info.SystemName,
        survey: data1.info.SurveyName,
        compliance: data1.compliance,
        questionsCount: data1.questionsCount
      },
      system2: {
        name: data2.info.SystemName,
        survey: data2.info.SurveyName,
        compliance: data2.compliance,
        questionsCount: data2.questionsCount
      },
      radar: {
        labels: radarLabels,
        dataset1,
        dataset2
      },
      delta: Math.round((data1.compliance - data2.compliance) * 10) / 10
    });
  } catch (error) {
    console.error('Benchmarking error:', error);
    res.status(500).json({ success: false, message: 'فشل إعداد المقارنة المعيارية' });
  }
});

module.exports = router;