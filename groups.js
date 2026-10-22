const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

// Map group ID or name to role
function getRoleForGroup(group) {
  const gId = group.group_id;
  const name = (group.group_name_a || '') + ' ' + (group.group_name_e || '');
  if (gId === 1 || name.includes('اداري') || name.includes('إداري') || name.includes('Admin') || name.includes('مستشار')) return 'admin';
  if (gId === 6 || name.includes('متابعة') || name.includes('رقابة') || name.includes('وكلاء')) return 'management';
  if (gId === 3 || gId === 4 || name.includes('فني') || name.includes('مبرمج') || name.includes('tech')) return 'tech';
  return 'enduser';
}

// 1. GET all groups with permissions counts & user counts
router.get('/', async (req, res) => {
  try {
    const sqlQuery = `
      SELECT g.group_id, g.group_name_a, g.group_name_e, g.group_date,
             ISNULL(g.status_code_id, 'ge_active_status') AS status_code_id,
             g.note, g.branch_id,
             (SELECT COUNT(*) FROM tst_group_detail_system WHERE group_id = CAST(g.group_id AS VARCHAR(16))) AS systems_count,
             (SELECT COUNT(*) FROM tst_group_detail_survey WHERE group_id = CAST(g.group_id AS VARCHAR(16))) AS surveys_count,
             (SELECT COUNT(*) FROM tst_group_detail_levels WHERE group_id = CAST(g.group_id AS VARCHAR(16))) AS levels_count,
             (SELECT COUNT(*) FROM tst_group_detail_classes WHERE group_id = CAST(g.group_id AS VARCHAR(16))) AS classes_count,
             (SELECT COUNT(*) FROM tst_group_detail_q_values WHERE group_id = CAST(g.group_id AS VARCHAR(16))) AS questions_count,
             (SELECT COUNT(*) FROM am_user_detail_group WHERE group_id = g.group_id) AS users_count
      FROM am_user_group g
      ORDER BY g.group_id ASC
    `;

    const result = await db.query(sqlQuery);
    const groups = (result.recordset || []).map(g => ({
      groupId: g.group_id,
      groupNameAr: g.group_name_a,
      groupNameEn: g.group_name_e,
      groupDate: g.group_date,
      statusCode: g.status_code_id,
      isActive: g.status_code_id !== 'ge_inactive_status',
      note: g.note || '',
      role: getRoleForGroup(g),
      systemsCount: g.systems_count || 0,
      surveysCount: g.surveys_count || 0,
      levelsCount: g.levels_count || 0,
      classesCount: g.classes_count || 0,
      questionsCount: g.questions_count || 0,
      usersCount: g.users_count || 0
    }));

    res.json({ success: true, groups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ success: false, message: 'فشل جلب قائمة المجموعات' });
  }
});

// 2. GET available items lookup for selection modal
router.get('/lookup/items', async (req, res) => {
  try {
    const { type, search, systemId, surveyId, levelId } = req.query;
    let query = '';
    const params = {};

    if (type === 'systems') {
      query = `SELECT SystemId AS id, SystemName AS name, system_counter FROM tst_systems WHERE 1=1`;
      if (search) {
        query += ` AND SystemName LIKE @search`;
        params.search = `%${search.trim()}%`;
      }
      query += ` ORDER BY SystemId ASC`;
    } else if (type === 'surveys') {
      query = `
        SELECT sur.SurveyId AS id, sur.SurveyName AS name, s.SystemName AS extra
        FROM tst_survey sur
        JOIN tst_systems s ON sur.SystemId = s.SystemId
        WHERE 1=1
      `;
      if (systemId) {
        query += ` AND sur.SystemId = @systemId`;
        params.systemId = parseInt(systemId);
      }
      if (search) {
        query += ` AND (sur.SurveyName LIKE @search OR s.SystemName LIKE @search)`;
        params.search = `%${search.trim()}%`;
      }
      query += ` ORDER BY sur.SurveyId ASC`;
    } else if (type === 'levels') {
      query = `
        SELECT l.LevelId AS id, l.LevelName AS name, sur.SurveyName AS extra
        FROM tst_survey_levels l
        JOIN tst_survey sur ON l.SurveyId = sur.SurveyId
        WHERE 1=1
      `;
      if (surveyId) {
        query += ` AND l.SurveyId = @surveyId`;
        params.surveyId = parseInt(surveyId);
      }
      if (search) {
        query += ` AND (l.LevelName LIKE @search OR sur.SurveyName LIKE @search)`;
        params.search = `%${search.trim()}%`;
      }
      query += ` ORDER BY l.LevelId ASC`;
    } else if (type === 'classes') {
      query = `
        SELECT c.ClassId AS id, c.ClassName AS name, l.LevelName AS extra
        FROM tst_survey_levels_class c
        JOIN tst_survey_levels l ON c.LevelId = l.LevelId
        WHERE 1=1
      `;
      if (levelId) {
        query += ` AND c.LevelId = @levelId`;
        params.levelId = parseInt(levelId);
      }
      if (search) {
        query += ` AND (c.ClassName LIKE @search OR l.LevelName LIKE @search)`;
        params.search = `%${search.trim()}%`;
      }
      query += ` ORDER BY c.ClassId ASC`;
    } else if (type === 'questions') {
      query = `
        SELECT q.value_id AS id, q.q_description AS name, c.ClassName AS extra,
               q.q_order, q.defect_category, q.weight
        FROM tst_system_q_values q
        LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
        WHERE 1=1
      `;
      if (surveyId) {
        query += ` AND q.survey_id = @surveyId`;
        params.surveyId = parseInt(surveyId);
      }
      if (levelId) {
        query += ` AND q.sur_level = @levelId`;
        params.levelId = parseInt(levelId);
      }
      if (search) {
        query += ` AND (q.q_description LIKE @search OR q.q_name LIKE @search OR c.ClassName LIKE @search)`;
        params.search = `%${search.trim()}%`;
      }
      query += ` ORDER BY q.value_id ASC`;
    } else {
      return res.status(400).json({ success: false, message: 'نوع البحث غير صحيح' });
    }

    const result = await db.query(query, params);
    res.json({ success: true, items: result.recordset || [] });
  } catch (error) {
    console.error('Error fetching lookup items:', error);
    res.status(500).json({ success: false, message: 'فشل جلب العناصر المتاحة' });
  }
});

// 3. GET single group with all 5 permission tables & users
router.get('/:id', async (req, res) => {
  try {
    const groupId = req.params.id;
    const strGid = groupId.toString();

    // 1. Group info
    const gRes = await db.query(`
      SELECT group_id, group_name_a, group_name_e, group_date,
             ISNULL(status_code_id, 'ge_active_status') AS status_code_id,
             note, branch_id
      FROM am_user_group
      WHERE group_id = @groupId
    `, { groupId: parseInt(groupId) });

    if (!gRes.recordset || gRes.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }

    const group = gRes.recordset[0];

    // 2. Systems
    const sysRes = await db.query(`
      SELECT g.group_id, g.system_id, ISNULL(g.note, '') AS note, s.SystemName AS system_name, g.system_counter
      FROM tst_group_detail_system g
      LEFT JOIN tst_systems s ON g.system_id = s.SystemId
      WHERE g.group_id = @strGid
      ORDER BY ISNULL(g.system_counter, 0), g.system_id
    `, { strGid });

    // 3. Surveys
    const surRes = await db.query(`
      SELECT g.group_id, g.survey_id, ISNULL(g.note, '') AS note, s.SurveyName AS survey_name, sys.SystemName AS system_name
      FROM tst_group_detail_survey g
      LEFT JOIN tst_survey s ON g.survey_id = s.SurveyId
      LEFT JOIN tst_systems sys ON s.SystemId = sys.SystemId
      WHERE g.group_id = @strGid
      ORDER BY g.survey_id
    `, { strGid });

    // 4. Levels
    const levRes = await db.query(`
      SELECT g.group_id, g.level_id, ISNULL(g.note, '') AS note, l.LevelName AS level_name, s.SurveyName AS survey_name
      FROM tst_group_detail_levels g
      LEFT JOIN tst_survey_levels l ON g.level_id = l.LevelId
      LEFT JOIN tst_survey s ON l.SurveyId = s.SurveyId
      WHERE g.group_id = @strGid
      ORDER BY g.level_id
    `, { strGid });

    // 5. Classes
    const clsRes = await db.query(`
      SELECT g.group_id, g.class_id, ISNULL(g.note, '') AS note, c.ClassName AS class_name, l.LevelName AS level_name
      FROM tst_group_detail_classes g
      LEFT JOIN tst_survey_levels_class c ON g.class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON c.LevelId = l.LevelId
      WHERE g.group_id = @strGid
      ORDER BY g.class_id
    `, { strGid });

    // 6. Questions
    const qRes = await db.query(`
      SELECT g.group_id, g.value_id, ISNULL(g.note, '') AS note, q.q_description AS value_name,
             c.ClassName AS class_name, l.LevelName AS level_name, s.SurveyName AS survey_name,
             ISNULL(q.defect_category, N'فني') AS defect_category, ISNULL(q.weight, 1.0) AS weight
      FROM tst_group_detail_q_values g
      LEFT JOIN tst_system_q_values q ON g.value_id = q.value_id
      LEFT JOIN tst_survey_levels_class c ON q.q_class_id = c.ClassId
      LEFT JOIN tst_survey_levels l ON q.sur_level = l.LevelId
      LEFT JOIN tst_survey s ON q.survey_id = s.SurveyId
      WHERE g.group_id = @strGid
      ORDER BY g.value_id
    `, { strGid });

    // 7. Assigned Users
    const usersRes = await db.query(`
      SELECT u.user_id, u.user_name_a, u.email, u.mobile, ISNULL(u.status_code_id, 'ge_active_status') AS status_code
      FROM am_user_detail_group dg
      JOIN am_user u ON dg.user_id = u.user_id
      WHERE dg.group_id = @groupId
      ORDER BY u.user_id
    `, { groupId: parseInt(groupId) });

    res.json({
      success: true,
      group: {
        groupId: group.group_id,
        groupNameAr: group.group_name_a,
        groupNameEn: group.group_name_e,
        groupDate: group.group_date,
        statusCode: group.status_code_id,
        isActive: group.status_code_id !== 'ge_inactive_status',
        note: group.note || '',
        role: getRoleForGroup(group)
      },
      systems: sysRes.recordset || [],
      surveys: surRes.recordset || [],
      levels: levRes.recordset || [],
      classes: clsRes.recordset || [],
      questions: qRes.recordset || [],
      users: usersRes.recordset || []
    });
  } catch (error) {
    console.error('Error fetching group details:', error);
    res.status(500).json({ success: false, message: 'فشل جلب تفاصيل المجموعة' });
  }
});

// 4. POST create new group
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { groupNameAr, groupNameEn, note, isActive, systems, surveys, levels, classes, questions } = req.body;

    if (!groupNameAr || !groupNameAr.trim()) {
      return res.status(400).json({ success: false, message: 'اسم المجموعة بالعربية مطلوب' });
    }

    const nameAr = groupNameAr.trim();
    const nameEn = (groupNameEn && groupNameEn.trim()) ? groupNameEn.trim() : nameAr;
    const statusCode = isActive === false ? 'ge_inactive_status' : 'ge_active_status';
    const groupNote = note || '';

    // Insert into am_user_group
    const insertGroupQuery = `
      INSERT INTO am_user_group (
        group_name_a, group_name_e, group_date, status_code_id,
        status_code_line, note, branch_id, entry_user_id, entry_date_time,
        edit_user_id, edit_date_time
      )
      OUTPUT INSERTED.group_id
      VALUES (
        @nameAr, @nameEn, GETDATE(), @statusCode,
        1, @groupNote, 1, '100', GETDATE(),
        '100', GETDATE()
      )
    `;

    const insRes = await db.query(insertGroupQuery, {
      nameAr,
      nameEn,
      statusCode,
      groupNote
    });

    const newGroupId = insRes.recordset[0].group_id;
    const strGid = newGroupId.toString();

    // Insert detail permissions if provided
    await syncGroupDetails(strGid, { systems, surveys, levels, classes, questions });

    res.json({
      success: true,
      message: 'تم إضافة المجموعة وحفظ صلاحياتها بنجاح',
      groupId: newGroupId
    });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ success: false, message: 'فشل إضافة المجموعة: ' + error.message });
  }
});

// 5. PUT update group header and all 5 permission tiers
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const groupId = req.params.id;
    const strGid = groupId.toString();
    const { groupNameAr, groupNameEn, note, isActive, systems, surveys, levels, classes, questions } = req.body;

    const statusCode = isActive === false ? 'ge_inactive_status' : 'ge_active_status';

    const updateGroupQuery = `
      UPDATE am_user_group
      SET group_name_a = ISNULL(@nameAr, group_name_a),
          group_name_e = ISNULL(@nameEn, group_name_e),
          note = ISNULL(@groupNote, note),
          status_code_id = @statusCode,
          edit_user_id = '100',
          edit_date_time = GETDATE()
      WHERE group_id = @groupId
    `;

    await db.query(updateGroupQuery, {
      groupId: parseInt(groupId),
      nameAr: groupNameAr ? groupNameAr.trim() : null,
      nameEn: groupNameEn ? groupNameEn.trim() : null,
      groupNote: note !== undefined ? note : null,
      statusCode
    });

    // Sync all 5 detail lists
    await syncGroupDetails(strGid, { systems, surveys, levels, classes, questions });

    res.json({
      success: true,
      message: 'تم تحديث بيانات المجموعة وحفظ مصفوفة الصلاحيات بنجاح'
    });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ success: false, message: 'فشل تحديث المجموعة: ' + error.message });
  }
});

// Helper to sync detail tables (Transactional when live SQL Server is connected)
async function syncGroupDetails(strGid, details) {
  const { systems, surveys, levels, classes, questions } = details;
  const pool = await db.getPool();

  if (db.isLive() && pool) {
    const transaction = new db.sql.Transaction(pool);
    await transaction.begin();
    try {
      // 1. Systems
      if (Array.isArray(systems)) {
        const reqDel = new db.sql.Request(transaction);
        await reqDel.input('strGid', db.sql.NVarChar, strGid).query(`DELETE FROM tst_group_detail_system WHERE group_id = @strGid`);
        let counter = 1;
        for (const sys of systems) {
          const sysId = typeof sys === 'object' ? sys.systemId || sys.system_id : sys;
          const note = (typeof sys === 'object' ? sys.note : '') || '';
          if (sysId) {
            const reqIns = new db.sql.Request(transaction);
            await reqIns.input('strGid', db.sql.NVarChar, strGid)
                        .input('sysId', db.sql.Int, parseInt(sysId))
                        .input('counter', db.sql.Int, counter)
                        .input('note', db.sql.NVarChar, note)
                        .query(`INSERT INTO tst_group_detail_system (group_id, system_id, system_counter, note) VALUES (@strGid, @sysId, @counter, @note)`);
            counter++;
          }
        }
      }

      // 2. Surveys
      if (Array.isArray(surveys)) {
        const reqDel = new db.sql.Request(transaction);
        await reqDel.input('strGid', db.sql.NVarChar, strGid).query(`DELETE FROM tst_group_detail_survey WHERE group_id = @strGid`);
        for (const sur of surveys) {
          const surId = typeof sur === 'object' ? sur.surveyId || sur.survey_id : sur;
          const note = (typeof sur === 'object' ? sur.note : '') || '';
          if (surId) {
            const reqIns = new db.sql.Request(transaction);
            await reqIns.input('strGid', db.sql.NVarChar, strGid)
                        .input('surId', db.sql.Int, parseInt(surId))
                        .input('note', db.sql.NVarChar, note)
                        .query(`INSERT INTO tst_group_detail_survey (group_id, survey_id, note) VALUES (@strGid, @surId, @note)`);
          }
        }
      }

      // 3. Levels
      if (Array.isArray(levels)) {
        const reqDel = new db.sql.Request(transaction);
        await reqDel.input('strGid', db.sql.NVarChar, strGid).query(`DELETE FROM tst_group_detail_levels WHERE group_id = @strGid`);
        for (const lev of levels) {
          const levId = typeof lev === 'object' ? lev.levelId || lev.level_id : lev;
          const note = (typeof lev === 'object' ? lev.note : '') || '';
          if (levId) {
            const reqIns = new db.sql.Request(transaction);
            await reqIns.input('strGid', db.sql.NVarChar, strGid)
                        .input('levId', db.sql.Int, parseInt(levId))
                        .input('note', db.sql.NVarChar, note)
                        .query(`INSERT INTO tst_group_detail_levels (group_id, level_id, note) VALUES (@strGid, @levId, @note)`);
          }
        }
      }

      // 4. Classes
      if (Array.isArray(classes)) {
        const reqDel = new db.sql.Request(transaction);
        await reqDel.input('strGid', db.sql.NVarChar, strGid).query(`DELETE FROM tst_group_detail_classes WHERE group_id = @strGid`);
        for (const cls of classes) {
          const clsId = typeof cls === 'object' ? cls.classId || cls.class_id : cls;
          const note = (typeof cls === 'object' ? cls.note : '') || '';
          if (clsId) {
            const reqIns = new db.sql.Request(transaction);
            await reqIns.input('strGid', db.sql.NVarChar, strGid)
                        .input('clsId', db.sql.Int, parseInt(clsId))
                        .input('note', db.sql.NVarChar, note)
                        .query(`INSERT INTO tst_group_detail_classes (group_id, class_id, note) VALUES (@strGid, @clsId, @note)`);
          }
        }
      }

      // 5. Questions
      if (Array.isArray(questions)) {
        const reqDel = new db.sql.Request(transaction);
        await reqDel.input('strGid', db.sql.NVarChar, strGid).query(`DELETE FROM tst_group_detail_q_values WHERE group_id = @strGid`);
        for (const q of questions) {
          const qValId = typeof q === 'object' ? q.valueId || q.value_id : q;
          const note = (typeof q === 'object' ? q.note : '') || '';
          if (qValId) {
            const reqIns = new db.sql.Request(transaction);
            await reqIns.input('strGid', db.sql.NVarChar, strGid)
                        .input('qValId', db.sql.Int, parseInt(qValId))
                        .input('note', db.sql.NVarChar, note)
                        .query(`INSERT INTO tst_group_detail_q_values (group_id, value_id, note) VALUES (@strGid, @qValId, @note)`);
          }
        }
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } else {
    // Fallback for mock mode
    if (Array.isArray(systems)) {
      await db.query(`DELETE FROM tst_group_detail_system WHERE group_id = @strGid`, { strGid });
      let counter = 1;
      for (const sys of systems) {
        const sysId = typeof sys === 'object' ? sys.systemId || sys.system_id : sys;
        const note = (typeof sys === 'object' ? sys.note : '') || '';
        if (sysId) {
          await db.query(`
            INSERT INTO tst_group_detail_system (group_id, system_id, system_counter, note)
            VALUES (@strGid, @sysId, @counter, @note)
          `, { strGid, sysId: parseInt(sysId), counter, note });
          counter++;
        }
      }
    }

    if (Array.isArray(surveys)) {
      await db.query(`DELETE FROM tst_group_detail_survey WHERE group_id = @strGid`, { strGid });
      for (const sur of surveys) {
        const surId = typeof sur === 'object' ? sur.surveyId || sur.survey_id : sur;
        const note = (typeof sur === 'object' ? sur.note : '') || '';
        if (surId) {
          await db.query(`
            INSERT INTO tst_group_detail_survey (group_id, survey_id, note)
            VALUES (@strGid, @surId, @note)
          `, { strGid, surId: parseInt(surId), note });
        }
      }
    }

    if (Array.isArray(levels)) {
      await db.query(`DELETE FROM tst_group_detail_levels WHERE group_id = @strGid`, { strGid });
      for (const lev of levels) {
        const levId = typeof lev === 'object' ? lev.levelId || lev.level_id : lev;
        const note = (typeof lev === 'object' ? lev.note : '') || '';
        if (levId) {
          await db.query(`
            INSERT INTO tst_group_detail_levels (group_id, level_id, note)
            VALUES (@strGid, @levId, @note)
          `, { strGid, levId: parseInt(levId), note });
        }
      }
    }

    if (Array.isArray(classes)) {
      await db.query(`DELETE FROM tst_group_detail_classes WHERE group_id = @strGid`, { strGid });
      for (const cls of classes) {
        const clsId = typeof cls === 'object' ? cls.classId || cls.class_id : cls;
        const note = (typeof cls === 'object' ? cls.note : '') || '';
        if (clsId) {
          await db.query(`
            INSERT INTO tst_group_detail_classes (group_id, class_id, note)
            VALUES (@strGid, @clsId, @note)
          `, { strGid, clsId: parseInt(clsId), note });
        }
      }
    }

    if (Array.isArray(questions)) {
      await db.query(`DELETE FROM tst_group_detail_q_values WHERE group_id = @strGid`, { strGid });
      for (const q of questions) {
        const qValId = typeof q === 'object' ? q.valueId || q.value_id : q;
        const note = (typeof q === 'object' ? q.note : '') || '';
        if (qValId) {
          await db.query(`
            INSERT INTO tst_group_detail_q_values (group_id, value_id, note)
            VALUES (@strGid, @qValId, @note)
          `, { strGid, qValId: parseInt(qValId), note });
        }
      }
    }
  }
}

// 6. DELETE group (Atomic Transaction)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const strGid = groupId.toString();

    // Prevent deletion of core admin groups
    if (groupId === 1 || groupId === 2) {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف المجموعات الأساسية للنظام (المجموعة 1 و 2)' });
    }

    const pool = await db.getPool();
    if (db.isLive() && pool) {
      const transaction = new db.sql.Transaction(pool);
      await transaction.begin();
      try {
        const detailTables = [
          'tst_group_detail_system',
          'tst_group_detail_survey',
          'tst_group_detail_levels',
          'tst_group_detail_classes',
          'tst_group_detail_q_values'
        ];
        for (const tbl of detailTables) {
          const reqTbl = new db.sql.Request(transaction);
          await reqTbl.input('strGid', db.sql.NVarChar, strGid).query(`DELETE FROM ${tbl} WHERE group_id = @strGid`);
        }
        const reqU = new db.sql.Request(transaction);
        await reqU.input('groupId', db.sql.Int, groupId).query(`DELETE FROM am_user_detail_group WHERE group_id = @groupId`);

        const reqG = new db.sql.Request(transaction);
        await reqG.input('groupId', db.sql.Int, groupId).query(`DELETE FROM am_user_group WHERE group_id = @groupId`);

        await transaction.commit();
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } else {
      // Fallback
      await db.query(`DELETE FROM tst_group_detail_system WHERE group_id = @strGid`, { strGid });
      await db.query(`DELETE FROM tst_group_detail_survey WHERE group_id = @strGid`, { strGid });
      await db.query(`DELETE FROM tst_group_detail_levels WHERE group_id = @strGid`, { strGid });
      await db.query(`DELETE FROM tst_group_detail_classes WHERE group_id = @strGid`, { strGid });
      await db.query(`DELETE FROM tst_group_detail_q_values WHERE group_id = @strGid`, { strGid });
      await db.query(`DELETE FROM am_user_detail_group WHERE group_id = @groupId`, { groupId });
      await db.query(`DELETE FROM am_user_group WHERE group_id = @groupId`, { groupId });
    }

    res.json({ success: true, message: 'تم حذف المجموعة وكافة الصلاحيات المرتبطة بها بنجاح وبشكل متكامل' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ success: false, message: 'فشل حذف المجموعة: ' + error.message });
  }
});

// 7. Cascade Helper (Auto-fill surveys, levels, classes, questions for a system)
router.post('/:id/cascade-add', requireAdmin, async (req, res) => {
  try {
    const groupId = req.params.id;
    const strGid = groupId.toString();
    const { systemId } = req.body;

    if (!systemId) {
      return res.status(400).json({ success: false, message: 'معرف النظام مطلوب' });
    }

    const sysId = parseInt(systemId);

    // 1. Add system
    await db.query(`
      IF NOT EXISTS (SELECT 1 FROM tst_group_detail_system WHERE group_id = @strGid AND system_id = @sysId)
        INSERT INTO tst_group_detail_system (group_id, system_id, system_counter, note)
        VALUES (@strGid, @sysId, 1, N'إدراج آلي')
    `, { strGid, sysId });

    // 2. Add surveys under this system
    await db.query(`
      INSERT INTO tst_group_detail_survey (group_id, survey_id, note)
      SELECT @strGid, SurveyId, N'إدراج آلي متسلسل'
      FROM tst_survey
      WHERE SystemId = @sysId
        AND SurveyId NOT IN (SELECT survey_id FROM tst_group_detail_survey WHERE group_id = @strGid)
    `, { strGid, sysId });

    // 3. Add levels under these surveys
    await db.query(`
      INSERT INTO tst_group_detail_levels (group_id, level_id, note)
      SELECT @strGid, l.LevelId, N'إدراج آلي متسلسل'
      FROM tst_survey_levels l
      JOIN tst_survey s ON l.SurveyId = s.SurveyId
      WHERE s.SystemId = @sysId
        AND l.LevelId NOT IN (SELECT level_id FROM tst_group_detail_levels WHERE group_id = @strGid)
    `, { strGid, sysId });

    // 4. Add classes under these levels
    await db.query(`
      INSERT INTO tst_group_detail_classes (group_id, class_id, note)
      SELECT @strGid, c.ClassId, N'إدراج آلي متسلسل'
      FROM tst_survey_levels_class c
      JOIN tst_survey_levels l ON c.LevelId = l.LevelId
      JOIN tst_survey s ON l.SurveyId = s.SurveyId
      WHERE s.SystemId = @sysId
        AND c.ClassId NOT IN (SELECT class_id FROM tst_group_detail_classes WHERE group_id = @strGid)
    `, { strGid, sysId });

    // 5. Add questions under this system
    await db.query(`
      INSERT INTO tst_group_detail_q_values (group_id, value_id, note)
      SELECT @strGid, q.value_id, N'إدراج آلي متسلسل'
      FROM tst_system_q_values q
      WHERE q.system_id = @sysId
        AND q.value_id NOT IN (SELECT value_id FROM tst_group_detail_q_values WHERE group_id = @strGid)
    `, { strGid, sysId });

    res.json({
      success: true,
      message: 'تم إدراج كافة الاستبيانات والمستويات والفئات والأسئلة التابعة للنظام بنجاح'
    });
  } catch (error) {
    console.error('Error cascading items:', error);
    res.status(500).json({ success: false, message: 'فشل الإدراج المتسلسل: ' + error.message });
  }
});

module.exports = router;
