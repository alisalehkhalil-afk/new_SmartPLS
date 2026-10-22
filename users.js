const express = require('express');
const router = express.Router();
const db = require('../config/db');
const whatsappService = require('../services/whatsappService');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

// Map group_id to system roles
function getRoleByGroupId(groupId) {
  if (groupId == 1 || groupId == 5) return 'admin';
  if (groupId == 6) return 'management';
  if (groupId == 3) return 'tech';
  return 'enduser';
}

function getGroupIdByRole(role) {
  if (role === 'admin') return 1;
  if (role === 'management') return 6;
  if (role === 'tech') return 3;
  return 4;
}

// GET all users
router.get('/', async (req, res) => {
  try {
    const sqlQuery = `
      SELECT u.user_id, u.user_name_a, u.user_name_e, u.user_password,
             u.description, u.email, u.mobile,
             ISNULL(u.status_code_id, 'ge_active_status') AS status_code,
             g.group_id, ISNULL(g.group_name_a, N'مستخدمون ميدانيون') AS group_name_a,
             s.SurveyId, s.SurveyName, sys.SystemName
      FROM am_user u
      LEFT JOIN am_user_detail_group dg ON u.user_id = dg.user_id
      LEFT JOIN am_user_group g ON dg.group_id = g.group_id
      LEFT JOIN tst_user_detail_survey uds ON u.user_id = uds.user_id
      LEFT JOIN tst_survey s ON uds.survey_id = s.SurveyId
      LEFT JOIN tst_systems sys ON s.SystemId = sys.SystemId
      ORDER BY u.user_id ASC
    `;

    const result = await db.query(sqlQuery);
    const users = (result.recordset || []).map(u => ({
      userId: u.user_id,
      userName: u.user_name_a || u.user_id,
      userNameEn: u.user_name_e || '',
      password: u.user_password || '1',
      description: u.description || '',
      email: u.email || '',
      mobile: u.mobile || '',
      groupId: u.group_id || 4,
      groupName: u.group_name_a,
      role: getRoleByGroupId(u.group_id),
      surveyId: u.SurveyId || null,
      surveyName: u.SurveyName || 'كافة الاستبيانات',
      systemName: u.SystemName || 'عام',
      isActive: u.status_code !== 'ge_inactive_status'
    }));

    res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'فشل جلب قائمة المستخدمين' });
  }
});

// GET user groups
router.get('/groups', async (req, res) => {
  try {
    const sqlQuery = `
      SELECT group_id, group_name_a, group_name_e, ISNULL(status_code_id, 'ge_active_status') AS status_code_id
      FROM am_user_group
      ORDER BY group_id ASC
    `;
    const result = await db.query(sqlQuery);
    const groups = (result.recordset || []).map(g => ({
      groupId: g.group_id,
      groupName: `${g.group_name_a} (${g.group_name_e})`,
      groupNameAr: g.group_name_a,
      groupNameEn: g.group_name_e,
      role: getRoleByGroupId(g.group_id),
      isActive: g.status_code_id !== 'ge_inactive_status'
    }));

    res.json({ success: true, groups });
  } catch (error) {
    console.error('Error fetching groups in users router:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب المجموعات' });
  }
});

// POST create user
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { userId, userName, userNameEn, password, email, mobile, role, groupId, surveyId, description } = req.body;

    if (!userId || !userName) {
      return res.status(400).json({ success: false, message: 'كود المستخدم واسم المستخدم مطلوبان' });
    }

    const finalUserId = userId.toString().trim();
    const finalGroupId = groupId ? parseInt(groupId) : getGroupIdByRole(role);
    const finalPw = password ? password.trim() : '1';
    const finalEn = (userNameEn && userNameEn.trim()) ? userNameEn.trim() : userName.trim();

    // 1. Insert into am_user
    const insertUserQuery = `
      IF NOT EXISTS (SELECT 1 FROM am_user WHERE user_id = @userId)
      BEGIN
        INSERT INTO am_user (
          user_id, user_name_a, user_name_e, user_password, email, mobile,
          description, sectore_id, edit_user_id, edit_date_time, registration_date, status_code_id
        ) VALUES (
          @userId, @userName, @userNameEn, @password, @email, @mobile,
          @description, 1, '100', GETDATE(), GETDATE(), 'ge_active_status'
        )
      END
      ELSE
      BEGIN
        UPDATE am_user
        SET user_name_a = @userName, user_name_e = @userNameEn, user_password = @password,
            email = @email, mobile = @mobile, description = @description, edit_date_time = GETDATE()
        WHERE user_id = @userId
      END
    `;

    await db.query(insertUserQuery, {
      userId: finalUserId,
      userName: userName.trim(),
      userNameEn: finalEn,
      password: finalPw,
      email: email || '',
      mobile: mobile || '',
      description: description || ''
    });

    // 2. Link Group
    const linkGroupQuery = `
      IF NOT EXISTS (SELECT 1 FROM am_user_detail_group WHERE user_id = @userId)
        INSERT INTO am_user_detail_group (user_id, group_id) VALUES (@userId, @groupId);
      ELSE
        UPDATE am_user_detail_group SET group_id = @groupId WHERE user_id = @userId;
    `;
    await db.query(linkGroupQuery, { userId: finalUserId, groupId: finalGroupId });

    // 3. Optional Survey Link
    if (surveyId) {
      const linkSurveyQuery = `
        IF NOT EXISTS (SELECT 1 FROM tst_user_detail_survey WHERE user_id = @userId)
          INSERT INTO tst_user_detail_survey (user_id, survey_id) VALUES (@userId, @surveyId);
        ELSE
          UPDATE tst_user_detail_survey SET survey_id = @surveyId WHERE user_id = @userId;
      `;
      await db.query(linkSurveyQuery, { userId: finalUserId, surveyId: parseInt(surveyId) });
    }

    // Trigger WhatsApp notification for new user credentials asynchronously
    (async () => {
      try {
        const config = await whatsappService.getConfig();
        if (config.is_enabled && config.notify_user_created && mobile && mobile.trim()) {
          const welcomeMsg = `👋 *أهلاً بك أستاذ ${userName.trim()}*\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `🏛️ تم إنشاء وتفعيل حسابك في *منصة New_SmartPLS* لتقييم الأنظمة المالية الحكومية.\n` +
            `👤 *اسم المستخدم:* ${finalUserId}\n` +
            `🔑 *كلمة المرور:* ${finalPw}\n` +
            `🎭 *مستوى الصلاحية:* ${getRoleByGroupId(finalGroupId)}\n` +
            `🌐 *رابط الدخول:* http://localhost:3000\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `يرجى المبادرة بتغيير كلمة المرور فور تسجيل الدخول.`;

          await whatsappService.sendMessage({
            to: mobile.trim(),
            message: welcomeMsg,
            eventType: 'user_credentials',
            recipientName: userName.trim(),
            sentByUser: 'admin'
          });
        }
      } catch (waErr) {
        console.warn('[WhatsApp Alert] User credentials notification error:', waErr.message);
      }
    })();

    res.json({
      success: true,
      message: 'تم إضافة المستخدم بنجاح وتعيين صلاحياته',
      user: {
        userId: finalUserId,
        userName,
        role: getRoleByGroupId(finalGroupId),
        groupId: finalGroupId
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ success: false, message: 'فشل حفظ بيانات المستخدم' });
  }
});

// PUT update user
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { userName, password, email, mobile, role, groupId, surveyId, description, isActive } = req.body;

    const finalGroupId = groupId ? parseInt(groupId) : (role ? getGroupIdByRole(role) : null);
    const statusVal = isActive === false ? 'ge_inactive_status' : 'ge_active_status';

    const updateUserQuery = `
      UPDATE am_user
      SET user_name_a = ISNULL(@userName, user_name_a),
          user_password = ISNULL(@password, user_password),
          email = ISNULL(@email, email),
          mobile = ISNULL(@mobile, mobile),
          description = ISNULL(@description, description),
          edit_date_time = GETDATE(),
          status_code_id = @statusVal
      WHERE user_id = @userId;
    `;

    await db.query(updateUserQuery, {
      userId,
      userName: userName || null,
      password: password || null,
      email: email || null,
      mobile: mobile || null,
      description: description || null,
      statusVal
    });

    if (finalGroupId) {
      await db.query(`
        IF EXISTS (SELECT 1 FROM am_user_detail_group WHERE user_id = @userId)
          UPDATE am_user_detail_group SET group_id = @groupId WHERE user_id = @userId;
        ELSE
          INSERT INTO am_user_detail_group (user_id, group_id) VALUES (@userId, @groupId);
      `, { userId, groupId: finalGroupId });
    }

    if (surveyId) {
      await db.query(`
        IF EXISTS (SELECT 1 FROM tst_user_detail_survey WHERE user_id = @userId)
          UPDATE tst_user_detail_survey SET survey_id = @surveyId WHERE user_id = @userId;
        ELSE
          INSERT INTO tst_user_detail_survey (user_id, survey_id) VALUES (@userId, @surveyId);
      `, { userId, surveyId: parseInt(surveyId) });
    }

    res.json({ success: true, message: 'تم تحديث بيانات المستخدم بنجاح' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, message: 'فشل تحديث المستخدم' });
  }
});

// DELETE user
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === '100') {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف حساب المستشار الإشرافي الرئيسي' });
    }

    await db.query(`DELETE FROM am_user_detail_group WHERE user_id = @userId`, { userId });
    await db.query(`DELETE FROM tst_user_detail_survey WHERE user_id = @userId`, { userId });
    await db.query(`DELETE FROM am_user WHERE user_id = @userId`, { userId });

    res.json({ success: true, message: 'تم حذف المستخدم بنجاح' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: 'فشل حذف المستخدم' });
  }
});

module.exports = router;
