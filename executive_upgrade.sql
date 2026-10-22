-- =====================================================================================
-- السكربت التحديثي التنفيذي الرسمي لمنصة New_SmartPLS (Executive Upgrade)
-- وزارة المالية - الوحدة التنفيذية لتقنية المعلومات
-- دعم دورة اعتماد اللجان، جلسات التقييم الرسمية، ومصفوفة المخاطر وخطة العمل التلقائية
-- متوافق 100% مع قاعدة بيانات Test_Soft.sql ويحافظ بالكامل على البيانات المدخلة
-- =====================================================================================

USE [Test_Soft];
GO

-- 1. إنشاء جدول جلسات التقييم الرسمية (tst_evaluation_sessions)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'tst_evaluation_sessions')
BEGIN
    CREATE TABLE [dbo].[tst_evaluation_sessions](
        [session_id] [int] IDENTITY(1,1) NOT NULL,
        [survey_id] [int] NOT NULL,
        [system_id] [int] NOT NULL,
        [session_title] [nvarchar](250) NOT NULL,
        [status] [nvarchar](50) NOT NULL CONSTRAINT [DF_tst_session_status] DEFAULT (N'DRAFT'),
        [lead_evaluator_id] [varchar](16) NULL,
        [notes] [nvarchar](500) NULL,
        [created_date] [datetime] NULL CONSTRAINT [DF_tst_session_created] DEFAULT (GETDATE()),
        [submitted_date] [datetime] NULL,
        [approved_date] [datetime] NULL,
        [approved_by] [varchar](16) NULL,
        CONSTRAINT [PK_tst_evaluation_sessions] PRIMARY KEY CLUSTERED ([session_id] ASC)
    );
    PRINT N'Created table tst_evaluation_sessions successfully.';
END
GO

-- 2. ترقية جدول تفاصيل إجابات التقييم لدعم ربطها بجلسة التقييم ووزن المقيم
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_user_detail_q_values' AND COLUMN_NAME = 'session_id'
)
BEGIN
    ALTER TABLE [dbo].[tst_user_detail_q_values]
    ADD [session_id] [int] NULL;
    PRINT N'Added session_id to tst_user_detail_q_values.';
END
GO

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_user_detail_q_values' AND COLUMN_NAME = 'evaluator_weight'
)
BEGIN
    ALTER TABLE [dbo].[tst_user_detail_q_values]
    ADD [evaluator_weight] [decimal](3, 2) NULL CONSTRAINT [DF_tst_eval_weight] DEFAULT (1.00);
    PRINT N'Added evaluator_weight to tst_user_detail_q_values.';
END
GO

-- 3. إنشاء جدول خطة العمل والتوصيات الإجرائية ومصفوفة المخاطر (tst_action_plans)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'tst_action_plans')
BEGIN
    CREATE TABLE [dbo].[tst_action_plans](
        [plan_id] [int] IDENTITY(1,1) NOT NULL,
        [session_id] [int] NULL,
        [survey_id] [int] NOT NULL,
        [value_id] [int] NOT NULL,
        [defect_type] [nvarchar](50) NOT NULL,
        [risk_level] [nvarchar](50) NOT NULL,
        [recommendation_text] [nvarchar](1000) NOT NULL,
        [corrective_action] [nvarchar](1000) NULL,
        [assigned_party] [nvarchar](250) NULL,
        [timeline_days] [int] NULL CONSTRAINT [DF_tst_action_timeline] DEFAULT (30),
        [status] [nvarchar](50) NULL CONSTRAINT [DF_tst_action_status] DEFAULT (N'مفتوح'),
        [created_date] [datetime] NULL CONSTRAINT [DF_tst_action_created] DEFAULT (GETDATE()),
        CONSTRAINT [PK_tst_action_plans] PRIMARY KEY CLUSTERED ([plan_id] ASC)
    );
    PRINT N'Created table tst_action_plans successfully.';
END
GO

-- 4. إدراج جلسة تقييم نموذجية معتمدة لنظام AFMIS لعام 2026 للعرض الفوري أمام المدراء
IF NOT EXISTS (SELECT 1 FROM [dbo].[tst_evaluation_sessions] WHERE [session_id] = 1)
BEGIN
    SET IDENTITY_INSERT [dbo].[tst_evaluation_sessions] ON;
    INSERT INTO [dbo].[tst_evaluation_sessions] (
        [session_id], [survey_id], [system_id], [session_title], [status],
        [lead_evaluator_id], [notes], [created_date], [approved_date], [approved_by]
    ) VALUES (
        1, 101, 10,
        N'جلسة التقييم والتشخيص الميداني لنظام AFMIS المالي للعام 2026',
        N'APPROVED',
        '100',
        N'تم اعتماد نتائج الفحص الميداني من قبل اللجنة الإشرافية العليا برئاسة المستشار.',
        GETDATE(), GETDATE(), '100'
    );
    SET IDENTITY_INSERT [dbo].[tst_evaluation_sessions] OFF;
    PRINT N'Seeded initial approved session for AFMIS.';
END
GO

-- تحديث السجلات الحالية لربطها بالجلسة رقم 1
UPDATE [dbo].[tst_user_detail_q_values]
SET [session_id] = 1, [evaluator_weight] = 1.00
WHERE [session_id] IS NULL;
GO

PRINT N'SUCCESS: Executive schema upgrade completed successfully.';
GO
