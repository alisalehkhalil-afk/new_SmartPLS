const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');
const { generatePdfReport, generateExcelReport } = require('../services/pdfGenerator');
const db = require('../config/db');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

// GET /api/whatsapp/config - Retrieve current WhatsApp configuration (Masked credentials)
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const config = await whatsappService.getConfig();
    res.json({
      success: true,
      config: {
        configId: config.config_id,
        gatewayUrl: config.gateway_url,
        tenantSerial: config.tenant_serial,
        apiToken: config.api_token ? '********' : '',
        secretKey: config.secret_key ? '********' : '',
        defaultCountryCode: config.default_country_code || '967',
        senderPhone: config.sender_phone || '',
        notifySessionApproved: !!config.notify_session_approved,
        notifyReportReady: !!config.notify_report_ready,
        notifyUserCreated: !!config.notify_user_created,
        isEnabled: !!config.is_enabled,
        updatedAt: config.updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching WhatsApp config:', error);
    res.status(500).json({ success: false, message: 'فشل جلب إعدادات الواتساب' });
  }
});

// POST /api/whatsapp/config - Save & update WhatsApp configuration
router.post('/config', requireAdmin, async (req, res) => {
  try {
    const {
      gatewayUrl,
      tenantSerial,
      apiToken,
      secretKey,
      defaultCountryCode,
      senderPhone,
      notifySessionApproved,
      notifyReportReady,
      notifyUserCreated,
      isEnabled
    } = req.body;

    const updated = await whatsappService.saveConfig({
      gateway_url: gatewayUrl,
      tenant_serial: tenantSerial,
      api_token: apiToken,
      secret_key: secretKey,
      default_country_code: defaultCountryCode,
      sender_phone: senderPhone,
      notify_session_approved: notifySessionApproved,
      notify_report_ready: notifyReportReady,
      notify_user_created: notifyUserCreated,
      is_enabled: isEnabled
    }, req.body.userId || 'admin');

    res.json({
      success: true,
      message: 'تم حفظ إعدادات الواتساب بنجاح وتحديث جداول النظام',
      config: updated
    });
  } catch (error) {
    console.error('Error saving WhatsApp config:', error);
    res.status(500).json({ success: false, message: 'فشل حفظ إعدادات الواتساب: ' + error.message });
  }
});

// GET /api/whatsapp/status - Live health & device connection status
router.get('/status', async (req, res) => {
  try {
    const status = await whatsappService.getStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error checking WhatsApp status:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ أثناء فحص حالة الاتصال بخادم الواتساب',
      error: error.message
    });
  }
});

// GET /api/whatsapp/qr - Live QR Code for device pairing
router.get('/qr', requireAdmin, async (req, res) => {
  try {
    const qrData = await whatsappService.getQrCode();
    res.json(qrData);
  } catch (error) {
    console.error('Error generating WhatsApp QR code:', error);
    res.status(500).json({ success: false, message: 'خطأ في توليد رمز الـ QR' });
  }
});

// POST /api/whatsapp/pairing-code - Request 8-digit Pairing Code
router.post('/pairing-code', requireAdmin, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف مطلوب لتوليد كود الاقتران السريع' });
    }
    const pairResult = await whatsappService.requestPairingCode(phoneNumber);
    res.json(pairResult);
  } catch (error) {
    console.error('Error requesting pairing code:', error);
    res.status(500).json({ success: false, message: 'فشل توليد كود الاقتران' });
  }
});

// POST /api/whatsapp/disconnect - Disconnect WhatsApp session
router.post('/disconnect', requireAdmin, async (req, res) => {
  try {
    const result = await whatsappService.disconnectDevice();
    res.json(result);
  } catch (error) {
    console.error('Error disconnecting WhatsApp device:', error);
    res.status(500).json({ success: false, message: 'فشل فصل الجلسة' });
  }
});

// POST /api/whatsapp/send-test - Send test message
router.post('/send-test', requireAdmin, async (req, res) => {
  try {
    const { phone, message, recipientName } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال رقم الهاتف ونص الرسالة' });
    }

    const sendResult = await whatsappService.sendMessage({
      to: phone,
      message,
      eventType: 'manual_test',
      recipientName: recipientName || 'اختبار يدوي',
      sentByUser: req.user ? req.user.userId : (req.body.userId || 'admin')
    });

    res.json(sendResult);
  } catch (error) {
    console.error('Error sending test message:', error);
    res.status(500).json({ success: false, message: 'خطأ أثناء إرسال الرسالة: ' + error.message });
  }
});

// GET /api/whatsapp/logs - Get recent WhatsApp audit logs
router.get('/logs', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await whatsappService.getLogs(limit);
    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error fetching WhatsApp logs:', error);
    res.status(500).json({ success: false, message: 'فشل جلب سجلات رسائل الواتساب' });
  }
});

// POST /api/whatsapp/send-report - Send executive report (PDF, Excel, Both, or Text) via WhatsApp
router.post('/send-report', requireAdmin, async (req, res) => {
  try {
    const { surveyId, recipientPhone, recipientName, customNote, format = 'both' } = req.body;
    if (!surveyId || !recipientPhone) {
      return res.status(400).json({ success: false, message: 'معرف الاستبيان ورقم المستلم مطلوبان' });
    }

    // Fetch survey & system info
    const info = await db.query(`
      SELECT s.SurveyId, s.SurveyName, sys.SystemName
      FROM tst_survey s
      JOIN tst_systems sys ON s.SystemId = sys.SystemId
      WHERE s.SurveyId = @surveyId
    `, { surveyId });

    if (!info.recordset || info.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'الاستبيان غير موجود' });
    }

    const survey = info.recordset[0];

    // Compute basic score
    const evals = await db.query(`
      SELECT AVG(CAST(ev.rating AS FLOAT)) AS avg_rating, COUNT(ev.value_id) AS total_evals
      FROM tst_user_detail_q_values ev
      JOIN tst_system_q_values q ON ev.value_id = q.value_id
      WHERE q.survey_id = @surveyId
    `, { surveyId });

    const avg = evals.recordset[0]?.avg_rating || 0;
    const compliance = ((avg / 5) * 100).toFixed(1);

    const messageText = `📊 *منصة New_SmartPLS - تقرير التقييم والتشخيص المالي*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🏛️ *النظام المالي:* ${survey.SystemName}\n` +
      `📋 *الاستبيان:* ${survey.SurveyName}\n` +
      `📈 *مؤشر الامتثال والجاهزية:* ${compliance}%\n` +
      `⭐ *متوسط درجات التقييم:* ${avg.toFixed(2)} من 5.0\n` +
      `📝 *عدد الفقرات المقيمة:* ${evals.recordset[0]?.total_evals || 0}\n` +
      (customNote ? `💬 *ملاحظات المستشار:* ${customNote}\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `الجمهورية اليمنية - وزارة المالية - الوحدة التنفيذية لتقنية المعلومات`;

    // 1. Text Only
    if (format === 'text') {
      const sendRes = await whatsappService.sendMessage({
        to: recipientPhone,
        message: messageText,
        eventType: 'executive_report_text',
        recipientName: recipientName || 'مسؤول النظام',
        sentByUser: req.body.userId || 'admin'
      });
      return res.json(sendRes);
    }

    // 2. Official PDF Only
    if (format === 'pdf') {
      const pdf = await generatePdfReport(surveyId);
      const sendPdfRes = await whatsappService.sendMediaMessage({
        to: recipientPhone,
        filePath: pdf.filePath,
        fileName: pdf.fileName,
        caption: messageText,
        eventType: 'executive_report_pdf',
        recipientName: recipientName || 'مسؤول النظام',
        sentByUser: req.body.userId || 'admin'
      });

      return res.json({
        ...sendPdfRes,
        format: 'pdf',
        pdfUrl: pdf.downloadUrl,
        downloadUrl: pdf.downloadUrl,
        message: sendPdfRes.success
          ? `✓ تم إرسال تقرير الـ PDF الرسمي [${pdf.fileName}] بنجاح عبر الواتساب!`
          : `تعذر إرسال ملف الـ PDF: ${sendPdfRes.message}`
      });
    }

    // 3. Official Excel Spreadsheet Only
    if (format === 'excel') {
      const xlsx = await generateExcelReport(surveyId);
      const sendXlsxRes = await whatsappService.sendMediaMessage({
        to: recipientPhone,
        filePath: xlsx.filePath,
        fileName: xlsx.fileName,
        caption: messageText,
        eventType: 'executive_report_excel',
        recipientName: recipientName || 'مسؤول النظام',
        sentByUser: req.body.userId || 'admin'
      });

      return res.json({
        ...sendXlsxRes,
        format: 'excel',
        excelUrl: xlsx.downloadUrl,
        downloadUrl: xlsx.downloadUrl,
        message: sendXlsxRes.success
          ? `✓ تم إرسال جدول بيانات الإكسل الرسمي [${xlsx.fileName}] بنجاح عبر الواتساب!`
          : `تعذر إرسال ملف الإكسل: ${sendXlsxRes.message}`
      });
    }

    // 4. Complete Package (Both PDF + Excel + Executive Summary)
    const [pdf, xlsx] = await Promise.all([
      generatePdfReport(surveyId),
      generateExcelReport(surveyId)
    ]);

    // Send Document 1: Official PDF with full executive caption
    const pdfRes = await whatsappService.sendMediaMessage({
      to: recipientPhone,
      filePath: pdf.filePath,
      fileName: pdf.fileName,
      caption: messageText,
      eventType: 'executive_report_pdf',
      recipientName: recipientName || 'مسؤول النظام',
      sentByUser: req.body.userId || 'admin'
    });

    // Send Document 2: Official Excel Data Sheet
    const excelRes = await whatsappService.sendMediaMessage({
      to: recipientPhone,
      filePath: xlsx.filePath,
      fileName: xlsx.fileName,
      caption: `📑 جدول البيانات التقييمية ومصفوفة المخاطر المعتمدة لنظام ${survey.SystemName} (.xlsx)`,
      eventType: 'executive_report_excel',
      recipientName: recipientName || 'مسؤول النظام',
      sentByUser: req.body.userId || 'admin'
    });

    const isAllSuccess = pdfRes.success && excelRes.success;

    return res.json({
      success: isAllSuccess || pdfRes.success || excelRes.success,
      status: isAllSuccess ? 'SENT' : (pdfRes.success ? 'PARTIAL' : 'FAILED'),
      format: 'both',
      pdf: { fileName: pdf.fileName, url: pdf.downloadUrl, success: pdfRes.success },
      excel: { fileName: xlsx.fileName, url: xlsx.downloadUrl, success: excelRes.success },
      downloadUrl: pdf.downloadUrl,
      message: isAllSuccess
        ? '✓ تم إرسال الحزمة الرسمية المتكاملة (تقرير PDF + ملف Excel) بنجاح عبر الواتساب!'
        : (pdfRes.success ? '✓ تم إرسال ملف الـ PDF بنجاح (وجاري استكمال الإكسل)' : 'تعذر إرسال المستندات عبر البوابة')
    });
  } catch (error) {
    console.error('Error sending WhatsApp report:', error);
    res.status(500).json({ success: false, message: 'فشل إرسال تقرير الواتساب: ' + error.message });
  }
});

// POST /api/whatsapp/send-survey-link - Send survey questionnaire link (Google Forms style) via WhatsApp
router.post('/send-survey-link', requireAdmin, async (req, res) => {
  try {
    const {
      surveyId,
      classIds,
      classNames,
      type = 'individual',
      recipientPhone,
      recipientName,
      groupId,
      linkMode = 'direct',
      customNote,
      baseUrl
    } = req.body;

    const sId = parseInt(surveyId);
    if (!sId) {
      return res.status(400).json({ success: false, message: 'معرف الاستبيان مطلوب' });
    }

    // 1. Fetch survey and system information
    const survRes = await db.query(`
      SELECT sur.SurveyId, sur.SurveyName, sys.SystemId, sys.SystemName
      FROM tst_survey sur WITH (NOLOCK)
      JOIN tst_systems sys WITH (NOLOCK) ON sur.SystemId = sys.SystemId
      WHERE sur.SurveyId = @surveyId
    `, { surveyId: sId });

    if (!survRes.recordset || survRes.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'الاستبيان غير موجود' });
    }

    const survey = survRes.recordset[0];
    const hostUrl = (baseUrl || req.headers.origin || `http://${req.headers.host}` || 'http://localhost:3000').replace(/\/+$/, '');

    // Format selected class IDs
    const classIdsStr = Array.isArray(classIds) ? classIds.filter(Boolean).join(',') : (classIds ? String(classIds).trim() : '');
    const cleanClassNames = classNames ? String(classNames).trim() : '';

    // Function to generate link
    const buildSurveyUrl = (targetName = '', targetPhone = '') => {
      if (linkMode === 'login') {
        let url = `${hostUrl}/evaluate.html?surveyId=${sId}`;
        if (classIdsStr) url += `&classIds=${encodeURIComponent(classIdsStr)}`;
        return url;
      }
      let url = `${hostUrl}/survey.html?surveyId=${sId}`;
      if (classIdsStr) url += `&classIds=${encodeURIComponent(classIdsStr)}`;
      if (targetName) url += `&name=${encodeURIComponent(targetName)}`;
      if (targetPhone) url += `&phone=${encodeURIComponent(targetPhone)}`;
      return url;
    };

    // 2. Individual Send
    if (type === 'individual') {
      if (!recipientPhone) {
        return res.status(400).json({ success: false, message: 'رقم هاتف المستهدف مطلوب للإرسال الفردي' });
      }

      const cleanPhone = String(recipientPhone).replace(/[^\d+]/g, '');
      const surveyUrl = buildSurveyUrl(recipientName, cleanPhone);

      const inviteMsg = `📋 *دعوة للمشاركة في استبيان تقييم النظام المالي الحكومي*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `تحية طيبة، ${recipientName ? 'سعادة الأخ/الأخت: *' + recipientName + '*' : 'سعادة المقيم المالي'}\n\n` +
        `تدعوكم وزارة المالية - الوحدة التنفيذية لتقنية المعلومات للمشاركة في استبيان تقييم:\n` +
        `🏛️ *النظام المالي:* ${survey.SystemName}\n` +
        `📋 *الاستبيان:* ${survey.SurveyName}\n` +
        (cleanClassNames ? `🎯 *المحاور المستهدفة:* ${cleanClassNames}\n` : '') +
        `\n` +
        `📲 *رابط تعبئة الأسئلة والتقييم مباشرة عبر الجوال:*\n` +
        `${surveyUrl}\n\n` +
        (customNote ? `💬 *ملاحظة:* ${customNote}\n\n` : '') +
        `يرجى التكرم بفتح الرابط وتعبئة محاور التقييم ومطابقة الشواهد الميدانية.\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `وزارة المالية - الجمهورية اليمنية`;

      const sendRes = await whatsappService.sendMessage({
        to: cleanPhone,
        message: inviteMsg,
        eventType: 'survey_link_individual',
        recipientName: recipientName || 'مستهدف الاستبيان',
        sentByUser: req.body.userId || 'admin'
      });

      return res.json({
        ...sendRes,
        surveyUrl,
        type: 'individual',
        message: sendRes.success
          ? `✓ تم إرسال رابط الاستبيان بنجاح إلى المستهدف (${cleanPhone}) عبر الواتساب!`
          : `تعذر إرسال الرابط: ${sendRes.message}`
      });
    }

    // 3. Group Send (Multiple registered members in target group with anti-ban delay & non-blocking queue)
    if (type === 'group') {
      const gId = parseInt(groupId);
      if (!gId) {
        return res.status(400).json({ success: false, message: 'المجموعة المستهدفة مطلوبة للإرسال الجماعي' });
      }

      const usersRes = await db.query(`
        SELECT u.user_id, u.user_name_a, u.mobile, g.group_name_a
        FROM am_user u
        JOIN am_user_detail_group dg ON u.user_id = dg.user_id
        JOIN am_user_group g ON dg.group_id = g.group_id
        WHERE g.group_id = @groupId AND u.mobile IS NOT NULL AND LEN(TRIM(u.mobile)) >= 8
      `, { groupId: gId });

      const members = usersRes.recordset || [];
      if (members.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'لا يوجد مستخدمون بأرقام هواتف صالحة مسجلين في هذه المجموعة'
        });
      }

      const currentUserId = req.user ? req.user.userId : (req.body.userId || 'admin');

      // Immediate non-blocking response to prevent HTTP timeout
      res.json({
        success: true,
        type: 'group',
        queued: true,
        totalMembers: members.length,
        message: `تم بدء جدولة إرسال دعوات الاستبيان عبر الواتساب إلى (${members.length}) من أعضاء المجموعة في الخلفية بأمان مع فاصل زمني لتجنب حظر الرقم.`
      });

      // Background Worker: Sequential send with randomized delay (2000ms - 4000ms) to avoid WhatsApp Spam Bans
      (async () => {
        console.log(`[WhatsApp Queue] Starting background survey dispatch to ${members.length} members in group ${gId}...`);
        for (let i = 0; i < members.length; i++) {
          const member = members[i];
          const memberPhone = String(member.mobile).replace(/[^\d+]/g, '');
          const memberName = member.user_name_a || member.user_id;
          const surveyUrl = buildSurveyUrl(memberName, memberPhone);

          const groupInviteMsg = `📋 *دعوة للمشاركة في استبيان تقييم النظام المالي الحكومي*\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `تحية طيبة، الأخ/الأخت: *${memberName}*\n` +
            `(${member.group_name_a || 'المجموعة المستهدفة'})\n\n` +
            `تدعوكم وزارة المالية - الوحدة التنفيذية لتقنية المعلومات للمشاركة في استبيان تقييم:\n` +
            `🏛️ *النظام المالي:* ${survey.SystemName}\n` +
            `📋 *الاستبيان:* ${survey.SurveyName}\n` +
            (cleanClassNames ? `🎯 *المحاور المستهدفة:* ${cleanClassNames}\n` : '') +
            `\n` +
            `📲 *رابط تعبئة الأسئلة والتقييم مباشرة عبر الجوال:*\n` +
            `${surveyUrl}\n\n` +
            (customNote ? `💬 *ملاحظة:* ${customNote}\n\n` : '') +
            `يرجى التكرم بالدخول وتعبئة محاور التقييم.\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `وزارة المالية - الجمهورية اليمنية`;

          try {
            await whatsappService.sendMessage({
              to: memberPhone,
              message: groupInviteMsg,
              eventType: 'survey_link_group',
              recipientName: memberName,
              sentByUser: currentUserId
            });
            console.log(`[WhatsApp Queue] [${i + 1}/${members.length}] Sent survey invitation to ${memberName} (${memberPhone})`);
          } catch (mErr) {
            console.warn(`[WhatsApp Queue] [${i + 1}/${members.length}] Failed to send to ${memberPhone}:`, mErr.message);
          }

          // Anti-ban delay: Wait 2-4 seconds between sends if there are more members
          if (i < members.length - 1) {
            const delayMs = 2000 + Math.floor(Math.random() * 2000);
            await new Promise(r => setTimeout(r, delayMs));
          }
        }
        console.log(`[WhatsApp Queue] Finished background survey dispatch for group ${gId}.`);
      })().catch(err => console.error('[WhatsApp Queue Background Error]:', err));

      return;
    }

    // 4. Return default direct link if requested
    const defaultUrl = buildSurveyUrl(recipientName, recipientPhone);
    return res.json({
      success: true,
      surveyUrl: defaultUrl,
      message: 'تم توليد رابط الاستبيان بنجاح'
    });

  } catch (error) {
    console.error('Error sending survey link via WhatsApp:', error);
    res.status(500).json({ success: false, message: 'فشل إرسال رابط الاستبيان: ' + error.message });
  }
});

module.exports = router;
