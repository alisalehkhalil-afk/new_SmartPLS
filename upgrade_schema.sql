-- =====================================================================================
-- السكربت التحديثي لمنصة تشخيص وتقييم الأنظمة المالية الحكومية (New_SmartPLS)
-- وزارة المالية - الوحدة التنفيذية لتقنية المعلومات
-- متوافق بالكامل مع قاعدة بيانات Test_Soft.sql
-- =====================================================================================

USE [Test_Soft];
GO

-- توسيع حقل اسم النظام لاستيعاب الأسماء الرسمية الطويلة
ALTER TABLE [dbo].[tst_systems] ALTER COLUMN [SystemName] NVARCHAR(250) NULL;
GO

-- 1. إضافة حقول تشخيص الخلل والوزن النسبي إلى جدول الأسئلة الديناميكية (tst_system_q_values)
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_system_q_values' AND COLUMN_NAME = 'defect_category'
)
BEGIN
    ALTER TABLE [dbo].[tst_system_q_values]
    ADD [defect_category] NVARCHAR(50) NULL CONSTRAINT [DF_tst_q_defect_category] DEFAULT (N'فني');
END
GO

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_system_q_values' AND COLUMN_NAME = 'weight'
)
BEGIN
    ALTER TABLE [dbo].[tst_system_q_values]
    ADD [weight] DECIMAL(5, 2) NULL CONSTRAINT [DF_tst_q_weight] DEFAULT (1.00);
END
GO

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_system_q_values' AND COLUMN_NAME = 'max_score'
)
BEGIN
    ALTER TABLE [dbo].[tst_system_q_values]
    ADD [max_score] INT NULL CONSTRAINT [DF_tst_q_max_score] DEFAULT (5);
END
GO

-- 2. ترقية جدول تفاصيل إجابات التقييم (tst_user_detail_q_values) لدعم مقياس ليكرت والشواهد والمبررات
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_user_detail_q_values' AND COLUMN_NAME = 'rating'
)
BEGIN
    ALTER TABLE [dbo].[tst_user_detail_q_values]
    ADD [rating] INT NULL;
END
GO

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_user_detail_q_values' AND COLUMN_NAME = 'score'
)
BEGIN
    ALTER TABLE [dbo].[tst_user_detail_q_values]
    ADD [score] DECIMAL(5, 2) NULL;
END
GO

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_user_detail_q_values' AND COLUMN_NAME = 'defect_category'
)
BEGIN
    ALTER TABLE [dbo].[tst_user_detail_q_values]
    ADD [defect_category] NVARCHAR(50) NULL;
END
GO

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_user_detail_q_values' AND COLUMN_NAME = 'evidence'
)
BEGIN
    ALTER TABLE [dbo].[tst_user_detail_q_values]
    ADD [evidence] NVARCHAR(MAX) NULL;
END
GO

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'tst_user_detail_q_values' AND COLUMN_NAME = 'eval_date'
)
BEGIN
    ALTER TABLE [dbo].[tst_user_detail_q_values]
    ADD [eval_date] DATETIME NULL CONSTRAINT [DF_tst_user_eval_date] DEFAULT (GETDATE());
END
GO

-- 3. غرس وتحديث الأنظمة المالية الحكومية المستهدفة (وزارة المالية)
IF NOT EXISTS (SELECT 1 FROM [dbo].[tst_systems] WHERE [SystemId] = 10 OR [SystemName] LIKE N'%AFMIS%')
BEGIN
    SET IDENTITY_INSERT [dbo].[tst_systems] ON;
    INSERT INTO [dbo].[tst_systems] ([SystemId], [SystemName], [system_counter])
    VALUES (10, N'نظام AFMIS المالي الحكومي', 0);
    SET IDENTITY_INSERT [dbo].[tst_systems] OFF;
END
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[tst_systems] WHERE [SystemId] = 20 OR [SystemName] LIKE N'%المحاسبي الموحد%')
BEGIN
    SET IDENTITY_INSERT [dbo].[tst_systems] ON;
    INSERT INTO [dbo].[tst_systems] ([SystemId], [SystemName], [system_counter])
    VALUES (20, N'النظام المحاسبي الحكومي الموحد', 0);
    SET IDENTITY_INSERT [dbo].[tst_systems] OFF;
END
GO

-- 4. غرس الاستبيانات الشاملة لنظام AFMIS في حال عدم وجودها
IF NOT EXISTS (SELECT 1 FROM [dbo].[tst_survey] WHERE [SurveyId] = 101)
BEGIN
    SET IDENTITY_INSERT [dbo].[tst_survey] ON;
    INSERT INTO [dbo].[tst_survey] ([SurveyId], [SystemId], [SurveyName])
    VALUES (101, 10, N'التقييم الشامل لكفاءة وجاهزية نظام AFMIS المالي');
    SET IDENTITY_INSERT [dbo].[tst_survey] OFF;
END
GO

-- 5. غرس المستويات والفئات المستهدفة
IF NOT EXISTS (SELECT 1 FROM [dbo].[tst_survey_levels] WHERE [LevelId] = 101)
BEGIN
    SET IDENTITY_INSERT [dbo].[tst_survey_levels] ON;
    INSERT INTO [dbo].[tst_survey_levels] ([LevelId], [SurveyId], [LevelName]) VALUES 
    (101, 101, N'الإدارة العليا واللجنة الإشرافية'),
    (102, 101, N'الفريق الفني ومسؤولو قواعد البيانات'),
    (103, 101, N'المستخدم النهائي والمحاسبون الميدانيون');
    SET IDENTITY_INSERT [dbo].[tst_survey_levels] OFF;
END
GO

-- 6. غرس المحاور والتصنيفات (Classes)
IF NOT EXISTS (SELECT 1 FROM [dbo].[tst_survey_levels_class] WHERE [ClassId] = 201)
BEGIN
    SET IDENTITY_INSERT [dbo].[tst_survey_levels_class] ON;
    INSERT INTO [dbo].[tst_survey_levels_class] ([ClassId], [LevelId], [ClassName]) VALUES 
    (201, 101, N'الحوكمة ودورة المستندات القانونية'),
    (202, 101, N'التقارير الرقابية ودعم اتخاذ القرار'),
    (203, 102, N'قواعد البيانات والنسخ الاحتياطي'),
    (204, 102, N'البنية التحتية والشبكة والأمان'),
    (205, 102, N'الربط والتكامل والتوافق البرمجي'),
    (206, 103, N'سهولة الواجهات وإدخال القيود'),
    (207, 103, N'دقة موازين المراجعة والأستاذ العام'),
    (208, 103, N'التدريب والدعم الفني الميداني');
    SET IDENTITY_INSERT [dbo].[tst_survey_levels_class] OFF;
END
GO

-- 7. تحديث تصنيفات الخلل والأوزان للأسئلة القديمة
UPDATE [dbo].[tst_system_q_values]
SET [defect_category] = CASE 
    WHEN [q_description] LIKE N'%لغة البرمجة%' OR [q_description] LIKE N'%كود%' OR [q_description] LIKE N'%أخطاء%' THEN N'برمجي'
    WHEN [q_description] LIKE N'%تدريب%' OR [q_description] LIKE N'%دليل استخدام%' OR [q_description] LIKE N'%فهم%' THEN N'سوء استخدام'
    WHEN [q_description] LIKE N'%صلاحيات%' OR [q_description] LIKE N'%لوائح%' OR [q_description] LIKE N'%إدارة%' THEN N'إداري'
    ELSE N'فني'
END,
[weight] = 1.00,
[max_score] = 5
WHERE [defect_category] IS NULL;
GO

PRINT N'SUCCESS: Schema upgraded and seeded successfully.';
GO
