'use strict';
/*
 * סכימת ליבה למערכת עריכת הדוחות הכספיים.
 * כל טבלאות הנתונים משויכות לגרסה (report_versions) שנושאת חברה+תקופה,
 * כדי לתמוך בדרישת-העל: התייחסות לחברה, לתקופת הדוח, ושמירת גרסאות.
 */

exports.up = async function up(knex) {
  // ---- משתמשים ----
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 60).notNullable().unique();
    t.string('full_name', 120);
    t.string('password_hash', 200).notNullable();
    t.boolean('is_admin').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ---- חברות ----
  await knex.schema.createTable('companies', (t) => {
    t.increments('id').primary();
    t.string('name', 160).notNullable();
    t.string('code', 40);
    t.boolean('is_consolidated').notNullable().defaultTo(false);
    t.integer('sort_order').defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ---- הרשאות: לכל משתמש, רמה per חברה (וכללי כשה-company_id ריק) ----
  // level: 'view' | 'edit'
  await knex.schema.createTable('permissions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('company_id').references('id').inTable('companies').onDelete('CASCADE'); // null = כל החברות
    t.string('level', 10).notNullable().defaultTo('view');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ---- תקופות דוח ----
  await knex.schema.createTable('periods', (t) => {
    t.increments('id').primary();
    t.integer('fiscal_year').notNullable();
    t.date('as_of_date').notNullable();
    t.string('label', 80); // לדוגמה: "שנתי 2025"
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['fiscal_year', 'as_of_date']);
  });

  // ---- גרסאות דוח (חברה + תקופה) ----
  // status: 'draft' | 'final'
  await knex.schema.createTable('report_versions', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.integer('period_id').notNullable().references('id').inTable('periods').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('status', 12).notNullable().defaultTo('draft');
    t.integer('based_on_version_id').references('id').inTable('report_versions');
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // ---- עץ שורות הדוח הכספי + ביאורים (ברמת חברה, משותף בין גרסאות) ----
  // statement: 'balance' (מאזן) | 'pnl' (רווח והפסד)
  await knex.schema.createTable('fs_lines', (t) => {
    t.increments('id').primary();
    t.integer('company_id').references('id').inTable('companies').onDelete('CASCADE'); // null = תבנית כללית
    t.string('statement', 12).notNullable();
    t.integer('parent_id').references('id').inTable('fs_lines');
    t.integer('sort_order').defaultTo(0);
    t.string('label', 200).notNullable();
    t.string('note_ref', 20); // מספר ביאור/שקף
    t.string('kind', 12).notNullable().defaultTo('line'); // 'header' | 'line' | 'total'
  });

  // ---- מאזן בוחן (per גרסה) ----
  await knex.schema.createTable('trial_balance_rows', (t) => {
    t.increments('id').primary();
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.string('account_no', 60).notNullable();
    t.string('account_name', 250);
    t.string('tb_section_code', 40);
    t.string('tb_section_name', 200);
    t.string('main_header', 120);
    t.string('sub_header', 160);
    t.decimal('amount', 24, 6).notNullable().defaultTo(0);
    t.decimal('prior_amount', 24, 6).defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['version_id', 'tb_section_code']);
    t.index(['version_id', 'account_no']);
  });

  // ---- אינדקס המרה: סעיף מאזן בוחן -> שורת דוח כספי (per חברה) ----
  await knex.schema.createTable('index_map', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.string('tb_section_code', 40).notNullable();
    t.string('tb_section_name', 200);
    t.integer('fs_line_id').references('id').inTable('fs_lines').onDelete('SET NULL');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.integer('row_version').notNullable().defaultTo(1); // optimistic lock
    t.unique(['company_id', 'tb_section_code']);
  });

  // ---- גליון פקודות נוספות (per גרסה) ----
  await knex.schema.createTable('adjustments', (t) => {
    t.increments('id').primary();
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.integer('entry_no'); // מספר פקודה (מקבץ שורות)
    t.string('account_no', 60);
    t.string('account_name', 250);
    t.string('tb_section_code', 40);
    t.string('tb_section_name', 200);
    t.string('purpose', 300); // מהות הפקודה
    t.decimal('amount', 24, 6).notNullable().defaultTo(0);
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.integer('row_version').notNullable().defaultTo(1);
    t.index(['version_id']);
  });

  // ---- גליון פקודות מיון (per גרסה) ----
  await knex.schema.createTable('reclassifications', (t) => {
    t.increments('id').primary();
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.string('account_no', 60);
    t.string('account_name', 250);
    t.string('from_section', 40); // סעיף מקור
    t.string('to_section', 40);   // סעיף יעד
    t.string('note', 300);
    t.decimal('amount', 24, 6).notNullable().defaultTo(0);
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.integer('row_version').notNullable().defaultTo(1);
    t.index(['version_id']);
  });

  // ---- לוג שינויים ----
  await knex.schema.createTable('audit_log', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users');
    t.string('username', 60);
    t.timestamp('ts').defaultTo(knex.fn.now());
    t.string('entity', 40).notNullable();
    t.string('entity_id', 40);
    t.string('action', 20).notNullable(); // create | update | delete | import | login
    t.integer('company_id');
    t.integer('version_id');
    t.text('before_json');
    t.text('after_json');
    t.index(['entity', 'entity_id']);
    t.index(['company_id', 'version_id']);
  });
};

exports.down = async function down(knex) {
  for (const tbl of [
    'audit_log', 'reclassifications', 'adjustments', 'index_map',
    'trial_balance_rows', 'fs_lines', 'report_versions', 'periods',
    'permissions', 'companies', 'users',
  ]) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
